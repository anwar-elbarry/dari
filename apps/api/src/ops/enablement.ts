import { RecordRetentionRule } from '../compliance/rules.service';

export type CheckStatus = 'ok' | 'fail' | 'warn' | 'manual';
export interface Check {
  id: string;
  status: CheckStatus;
  message: string;
}

/** Everything the check needs, gathered by the CLI (`check-enablement.ts`) so that the decisions below stay pure and tested. */
export interface EnablementInput {
  nodeEnv: string;
  /** Null when the environment does not validate with the guest feature on; `envIssues` then lists variable names and reasons, never values. */
  config: { appUrl: string; mailDriver: string; opsAlertEmail?: string; ocrConfigured: boolean } | null;
  envIssues: string[];
  consentLocales: { fr: boolean; en: boolean };
  retention: { idImages: { validated: boolean }; fiche: RecordRetentionRule; register: RecordRetentionRule };
  /** Null = not run (the environment is invalid, so there is nothing to connect to). */
  storageRoundTrip: boolean | null;
  chromium: boolean;
  /** Phase 5: the tax estimate's rules and the disclaimer wording (`TAX_REPORTS_ENABLED`). */
  tax: { disclaimersPresent: boolean; rulesValidated: boolean };
}

/** Steps that no code can verify. Printed every time, never counted as passed. */
export const MANUAL_STEPS: readonly Check[] = [
  { id: 'gate.cndp', status: 'manual', message: 'CNDP declaration filed and, if required, the authorization received' },
  { id: 'gate.hosting', status: 'manual', message: 'Hosting region and storage provider confirmed with counsel (cross-border position, including the mail provider)' },
  { id: 'gate.mail-domain', status: 'manual', message: 'Mail sender domain verified with the provider (SPF and DKIM)' },
  { id: 'infra.bucket', status: 'manual', message: 'Bucket is private, TLS only, versioning off or expiring within the retention window, credentials limited to that bucket' },
  { id: 'infra.keys', status: 'manual', message: 'STORAGE_MASTER_KEYS backed up separately from the data (without a key its objects cannot be read)' },
  { id: 'infra.backups', status: 'manual', message: 'Daily database backups, with one restore tested' },
  { id: 'infra.edge', status: 'manual', message: 'Edge proxy overwrites X-Forwarded-For (docs/deployment.md); forged header checked against the audit log' },
  { id: 'infra.ocr-network', status: 'manual', message: 'Document worker not reachable from the internet' },
  { id: 'gate.runbook', status: 'manual', message: 'Incident runbook for a personal-data leak written' },
  { id: 'gate.police-form', status: 'manual', message: 'Official police form obtained; Fiche layout compared with it (TEMPLATE_VERSION bumped if changed)' },
];

const mark = (id: string, ok: boolean, good: string, bad: string, level: 'fail' | 'warn' = 'fail'): Check => ({ id, status: ok ? 'ok' : level, message: ok ? good : bad });

/** Decides whether GUEST_CHECKIN_ENABLED=true is safe to set. Any `fail` blocks it; `warn` is a known, accepted gap. */
export function evaluateEnablement(i: EnablementInput): Check[] {
  const checks: Check[] = [
    mark('env.production', i.nodeEnv === 'production', 'NODE_ENV is production', `NODE_ENV is "${i.nodeEnv}": run this check with the production environment`),
    mark('env.valid', i.envIssues.length === 0, 'Environment valid with the guest feature on (storage, keys, SSE, mail, Redis)', `Environment invalid with the guest feature on:\n${i.envIssues.map((s) => `      ${s}`).join('\n')}`),
  ];
  if (i.config) {
    checks.push(
      mark('env.mail', i.config.mailDriver === 'resend', 'Mail driver is resend', `Mail driver is "${i.config.mailDriver}": links and alerts cannot be delivered`),
      mark('env.app-url', i.config.appUrl.startsWith('https://'), 'APP_URL is https', 'APP_URL is not https: check-in links would be sent over plain HTTP'),
      mark('env.ops-alert', !!i.config.opsAlertEmail, 'OPS_ALERT_EMAIL set: a failing retention job raises an alert', 'OPS_ALERT_EMAIL is not set: a failing retention job would go unnoticed'),
      mark('env.ocr', i.config.ocrConfigured, 'Document worker configured', 'Document worker not configured: guests type their details (accepted, OCR is assistive)', 'warn'),
    );
  }
  checks.push(
    mark('consent.fr', i.consentLocales.fr, 'Approved consent text (fr)', 'No approved consent text in French: the guest flow refuses to start'),
    mark('consent.en', i.consentLocales.en, 'Approved consent text (en)', 'No approved consent text in English: the guest flow refuses to start'),
    mark('retention.id-images', i.retention.idImages.validated, 'ID image retention validated by counsel', 'retention.id_images_days is still the unvalidated default'),
    retentionCheck('retention.fiche', 'Fiche PDF', i.retention.fiche, 'fail'),
    retentionCheck('retention.register', 'Police register', i.retention.register, 'warn'),
  );
  checks.push(
    i.storageRoundTrip === null
      ? { id: 'storage.round-trip', status: 'fail', message: 'Storage round trip not run (fix the environment first)' }
      : mark('storage.round-trip', i.storageRoundTrip, 'Storage: write, read and delete of a test object succeeded', 'Storage: the round trip of a test object failed (endpoint, bucket or credentials)'),
    mark('tax.disclaimer', i.tax.disclaimersPresent, 'Tax disclaimer wording present in RuleConfig (fr, en; beta and standard)', 'Tax disclaimer wording missing from RuleConfig: tax exports are refused'),
    mark('tax.rules', i.tax.rulesValidated, 'Tax rules validated by a fiduciaire', 'Tax rules are unvalidated defaults: every tax report and export is a BETA estimate with a watermark (accepted while the fiduciaire has not validated them)', 'warn'),
    mark('pdf.chromium', i.chromium, 'Chromium starts: Fiche PDFs can be generated', 'Chromium does not start (install it, or set PDF_CHROMIUM_PATH): Fiche PDFs would be unavailable'),
  );
  return [...checks, ...MANUAL_STEPS];
}

function retentionCheck(id: string, label: string, r: RecordRetentionRule, level: 'fail' | 'warn'): Check {
  if (r.enforceable !== null) return { id, status: 'ok', message: `${label} retention set to ${r.enforceable} days and validated` };
  const why = r.days === null ? 'no period set' : 'period set but not validated by counsel';
  return { id, status: level, message: `${label} retention: ${why}; files are kept until counsel decides` };
}

export function summarize(checks: Check[]): { blocked: boolean; failed: number; warnings: number; manual: number } {
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  return { blocked: count('fail') > 0, failed: count('fail'), warnings: count('warn'), manual: count('manual') };
}
