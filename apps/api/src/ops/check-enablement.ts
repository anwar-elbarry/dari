/*
 * Run before setting GUEST_CHECKIN_ENABLED=true in production:
 *   npm run check:enablement -w apps/api      (with the production environment loaded)
 * It reads the environment and the database and writes to the storage bucket a random test object of its own
 * (no personal data) that it deletes at once. Exit code 1 when anything blocks the switch.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { RulesService } from '../compliance/rules.service';
import { TaxRulesService } from '../tax/tax-rules.service';
import { AppConfig, parseEnv } from '../config/env';
import { S3ObjectStore } from '../storage/s3-object-store';
import { CheckStatus, evaluateEnablement, EnablementInput, summarize } from './enablement';

async function storageRoundTrip(c: AppConfig): Promise<boolean> {
  try {
    const store = new S3ObjectStore({
      endpoint: c.S3_ENDPOINT, region: c.S3_REGION, bucket: c.S3_BUCKET!, accessKey: c.S3_ACCESS_KEY!, secretKey: c.S3_SECRET_KEY!,
      forcePathStyle: c.S3_FORCE_PATH_STYLE, serverSideEncryption: c.S3_SSE, maxBytes: c.STORAGE_MAX_BYTES + 1024,
    });
    const key = `enablement-check/${randomUUID()}`;
    const body = randomBytes(64);
    await store.put(key, body);
    const same = body.equals(await store.get(key));
    await store.delete(key);
    return same;
  } catch {
    return false;
  }
}

async function taxStatus(rules: TaxRulesService): Promise<EnablementInput['tax']> {
  try {
    return { disclaimersPresent: true, rulesValidated: (await rules.status()).rules.every((r) => r.validated) };
  } catch {
    return { disclaimersPresent: false, rulesValidated: false };
  }
}

async function chromiumStarts(c: Pick<AppConfig, 'PDF_CHROMIUM_PATH' | 'PDF_NO_SANDBOX'>): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: !c.PDF_NO_SANDBOX, ...(c.PDF_CHROMIUM_PATH ? { executablePath: c.PDF_CHROMIUM_PATH } : {}), args: ['--disable-gpu', '--disable-dev-shm-usage'] });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Validate as if the feature were on, so the production requirements for storage and keys are applied.
  let config: AppConfig | null = null;
  let envIssues: string[] = [];
  try {
    config = parseEnv({ ...process.env, GUEST_CHECKIN_ENABLED: 'true' });
  } catch (e) {
    envIssues = (e instanceof Error ? e.message : 'invalid').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  }

  const prisma = new PrismaClient();
  try {
    const consent = async (locale: string) => (await prisma.consentText.count({ where: { locale, approvedAt: { not: null, lte: new Date() } } })) > 0;
    const rules = new RulesService(prisma as never);
    const input: EnablementInput = {
      nodeEnv: process.env.NODE_ENV ?? 'development',
      config: config && { appUrl: config.APP_URL, mailDriver: config.MAIL_DRIVER, opsAlertEmail: config.OPS_ALERT_EMAIL, ocrConfigured: !!config.OCR_SERVICE_URL },
      envIssues,
      consentLocales: { fr: await consent('fr'), en: await consent('en') },
      retention: { idImages: { validated: (await rules.idRetention()).validated }, fiche: await rules.ficheRetention(), register: await rules.policeRegisterRetention() },
      storageRoundTrip: config ? await storageRoundTrip(config) : null,
      tax: await taxStatus(new TaxRulesService(prisma as never)),
      messaging: {
        driverCloud: process.env.WHATSAPP_DRIVER === 'cloud',
        webhookConfigured: !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN,
        templatesApproved: Object.keys((await rules.whatsappTemplates()).templates).length,
        checklistValidated: (await prisma.checklistTemplateStep.count()) > 0 && (await prisma.checklistTemplateStep.count({ where: { validatedBy: null } })) === 0,
        licenseRetention: await rules.licenseDocumentRetention(),
      },
      chromium: await chromiumStarts({ PDF_CHROMIUM_PATH: config?.PDF_CHROMIUM_PATH ?? process.env.PDF_CHROMIUM_PATH, PDF_NO_SANDBOX: config?.PDF_NO_SANDBOX ?? process.env.PDF_NO_SANDBOX === 'true' }),
    };
    const checks = evaluateEnablement(input);
    const label: Record<CheckStatus, string> = { ok: 'OK    ', fail: 'FAIL  ', warn: 'WARN  ', manual: 'MANUAL' };
    for (const c of checks) console.log(`${label[c.status]} ${c.id.padEnd(20)} ${c.message}`);
    const s = summarize(checks);
    console.log(`\n${s.failed} blocking, ${s.warnings} warning(s), ${s.manual} manual step(s) to confirm (docs/pilot-checklist.md).`);
    console.log(s.blocked ? 'NOT READY: keep GUEST_CHECKIN_ENABLED off.' : 'No automatic blocker. Confirm the manual steps, then set GUEST_CHECKIN_ENABLED=true.');
    process.exitCode = s.blocked ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error('The check itself failed to run (database unreachable?).');
  process.exit(2);
});
