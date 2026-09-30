import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * The BETA rule rows the migration seeds, as test fixtures (`resetDatabase` empties RuleConfig). These are the
 * founder's unvalidated defaults, not a legal position; a test that needs validated rules passes `validatedBy`.
 */
export async function seedTaxRules(prisma: PrismaService, opts: { validatedBy?: string } = {}) {
  const validated = opts.validatedBy ? { validatedBy: opts.validatedBy, validatedAt: new Date('2026-10-01') } : {};
  const rows: [string, object][] = [
    ['tax.property_income', { thresholdCentimes: 12_000_000, belowBps: 1000, aboveBps: 1500, mode: 'WHOLE' }],
    ['tax.vat', { rateBps: 1000, basis: 'INCLUSIVE' }],
    ['tax.rounding', { mode: 'HALF_UP', scope: 'LINE' }],
    ['tax.stay_month', { rule: 'CHECKOUT_MONTH' }],
    ['tax.disclaimer.beta.en', { version: 'beta-1', banner: 'BETA ESTIMATE - UNVERIFIED', text: 'BETA ESTIMATE - UNVERIFIED. This is a mathematical projection only and has NOT been validated by a licensed accountant. Do not use for official DGI declarations without consulting your Fiduciaire.' }],
    ['tax.disclaimer.beta.fr', { version: 'beta-1', banner: 'ESTIMATION BÊTA - NON VÉRIFIÉE', text: "ESTIMATION BÊTA - NON VÉRIFIÉE. Il s'agit d'une simple projection mathématique, qui n'a PAS été validée par un expert-comptable agréé. Ne pas utiliser pour des déclarations officielles à la DGI sans consulter votre fiduciaire." }],
    ['tax.disclaimer.standard.en', { version: 'std-1', banner: 'ESTIMATE ONLY', text: 'Estimate only - confirm with your accountant.' }],
    ['tax.disclaimer.standard.fr', { version: 'std-1', banner: 'ESTIMATION UNIQUEMENT', text: 'Estimation uniquement - à confirmer avec votre comptable.' }],
  ];
  for (const [key, value] of rows) {
    const withStatus = key.startsWith('tax.disclaimer') ? {} : validated;
    await prisma.ruleConfig.upsert({ where: { key }, update: { value, ...withStatus }, create: { key, value, ...withStatus } });
  }
}

/** A stored report row with two encrypted stub files, for routes that need an existing report. */
export async function insertTaxReport(prisma: PrismaService, storage: StorageService, o: { accountId: string; propertyId: string; userId: string; month: string }) {
  const pdf = await storage.put(o.accountId, 'TAX_REPORT_PDF', Buffer.from('%PDF-1.4 tax stub'));
  const xlsx = await storage.put(o.accountId, 'TAX_REPORT_XLSX', Buffer.from('PK stub'));
  return prisma.taxReport.create({
    data: {
      accountId: o.accountId, propertyId: o.propertyId, month: o.month, regime: 'PROPERTY_INCOME', nightsRevenue: '0.00', addonRevenue: '0.00', grossBase: '0.00', taxeSejourDeducted: '0.00', vatTotal: '0.00',
      incomeTaxTotal: '0.00', localTaxTotal: '0.00', lines: [], problems: [], ruleVersions: [], unvalidated: true, inputDigest: 'd', pdfObjectId: pdf.id, xlsxObjectId: xlsx.id,
      templateVersion: 'draft-1', disclaimerVersion: 'beta-1', generatedBy: o.userId,
    },
  });
}
