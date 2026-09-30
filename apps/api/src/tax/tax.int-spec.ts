import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright-core';
import { AuditService } from '../audit/audit.service';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { MemoryObjectStore } from '../storage/memory-object-store';
import { OBJECT_STORE } from '../storage/object-store';
import { StorageService } from '../storage/storage.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { seedTaxRules } from '../test/tax-fixtures';

requireDatabase();

/** These tests drive a real Chromium. CI sets REQUIRE_CHROMIUM=1 so a missing browser fails instead of skipping. */
function chromiumAvailable(): boolean {
  const path = process.env.PW_CHROMIUM_PATH;
  if (path) return existsSync(path);
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
const haveChromium = chromiumAvailable();
if (!haveChromium && process.env.REQUIRE_CHROMIUM) throw new Error('REQUIRE_CHROMIUM is set but no Chromium was found');
const suite = haveChromium ? describe : describe.skip;

const text = (pdf: Buffer) => execFileSync(process.execPath, [join(__dirname, '../test/pdf-text.mjs')], { input: pdf, maxBuffer: 20 * 1024 * 1024 }).toString('utf8').replace(/\s+/g, ' ');
function binary(res: import('supertest').Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const BETA = 'BETA ESTIMATE - UNVERIFIED';
const line = (report: { lines: { key: string; amount: number | null; note?: string }[] }, key: string) => report.lines.find((l) => l.key === key)!;

suite('monthly tax estimates (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let store: MemoryObjectStore;
  let ownerId: string;
  let propertyId: string;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const property = (accountId: string, owner: string, over: Record<string, unknown> = {}) =>
    t.prisma.property.create({ data: { accountId, ownerId: owner, name: 'Riad Test', address: '1 rue Secrète', commune: 'Marrakech', licenseType: 'RIAD', ...over } });
  const stay = (accountId: string, propId: string, checkIn: string, checkOut: string, amounts: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
    t.prisma.booking.create({ data: { accountId, propertyId: propId, checkIn: new Date(checkIn), checkOut: new Date(checkOut), source: 'DIRECT', partySize: 2, ...amounts, ...over } });
  const generate = (month = '2026-03', who = a.as.OWNER_MANAGER, id = propertyId) => who.post(`/api/properties/${id}/tax-reports/${month}`);
  const download = (reportId: string, kind: 'pdf' | 'xlsx', who = a.as.OWNER_MANAGER) => who.get(`/api/tax/reports/${reportId}/${kind}`).buffer(true).parse(binary);

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    await seedTaxRules(t.prisma);
    ownerId = (await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Secret Owner Name', residency: 'RESIDENT' } })).id;
    propertyId = (await property(a.accountId, ownerId)).id;
    // 60 000, 50 000 and 30 000 MAD by check-out month: the year to date crosses the threshold in March.
    await stay(a.accountId, propertyId, '2026-01-05', '2026-01-10', { nightlyRevenue: '60000.00' });
    await stay(a.accountId, propertyId, '2026-02-08', '2026-02-12', { nightlyRevenue: '49800.00', cleaningFee: '200.00' });
    await stay(a.accountId, propertyId, '2026-03-05', '2026-03-10', { nightlyRevenue: '29500.00', addonRevenue: '500.00', platformCommission: '4500.00' });
  });

  describe('the estimate', () => {
    it('follows the rules: lower rate in February, catch-up at the higher rate in March, every line in centimes', async () => {
      const feb = (await generate('2026-02').expect(200)).body;
      expect(line(feb, 'gross_base').amount).toBe(5_000_000);
      expect(line(feb, 'income_tax')).toMatchObject({ amount: 500_000, note: 'rate_bps' }); // 10 % of 110 000 less 10 % of 60 000

      const mar = (await generate('2026-03').expect(200)).body;
      expect(mar.totals).toMatchObject({ nightsRevenue: 2_950_000, addonRevenue: 50_000, grossBase: 3_000_000, taxeSejourDeducted: 0, incomeTaxTotal: 1_000_000, vatTotal: 0, localTaxTotal: 0 });
      expect(line(mar, 'income_tax')).toMatchObject({ amount: 1_000_000, note: 'catch_up' }); // 15 % of 140 000 less 10 % of 110 000
      expect(line(mar, 'platform_commission')).toMatchObject({ amount: 450_000 });
      expect(line(mar, 'local_tax')).toMatchObject({ amount: null, note: 'rule_missing' }); // no TaxRule for the commune
      expect(mar.beta).toBe(true);
      const row = await t.prisma.taxReport.findFirstOrThrow({ where: { month: '2026-03' } });
      expect(row.grossBase.toFixed(2)).toBe('30000.00');
      expect(row.incomeTaxTotal.toFixed(2)).toBe('10000.00');
    });

    it('counts confirmed bookings only, and the owner’s other properties for the rate but not for the amount', async () => {
      await stay(a.accountId, propertyId, '2026-03-11', '2026-03-13', { nightlyRevenue: '99999.00' }, { status: 'CANCELLED' });
      await stay(a.accountId, propertyId, '2026-03-14', '2026-03-16', { nightlyRevenue: '99999.00' }, { classification: 'OWNER_BLOCK' });
      const other = await property(a.accountId, ownerId, { name: 'Second riad' });
      await stay(a.accountId, other.id, '2026-01-05', '2026-01-08', { nightlyRevenue: '20000.00' });
      const mar = (await generate('2026-03').expect(200)).body;
      expect(mar.totals.grossBase).toBe(3_000_000); // nothing of the cancelled stay, the block or the other property
      // Owner year to date 160 000 (15 %), before March 130 000 (15 %): no rate change, the property's own figures only.
      expect(line(mar, 'income_tax')).toMatchObject({ amount: 2_100_000 - 1_650_000, note: 'rate_bps' });
      // Another owner's property does not count.
      const stranger = (await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Other Owner', residency: 'RESIDENT' } })).id;
      const foreign = await property(a.accountId, stranger, { name: 'Elsewhere' });
      await stay(a.accountId, foreign.id, '2026-01-05', '2026-01-08', { nightlyRevenue: '500000.00' });
      expect(line((await generate('2026-03').expect(200)).body, 'income_tax').amount).toBe(2_100_000 - 1_650_000);
    });

    it('deducts an included Taxe de Séjour, and reports stays without amounts by id, never a name', async () => {
      await t.prisma.property.update({ where: { id: propertyId }, data: { taxeSejourMode: 'INCLUDED' } });
      const bare = await stay(a.accountId, propertyId, '2026-03-20', '2026-03-22');
      const withTs = await stay(a.accountId, propertyId, '2026-03-23', '2026-03-25', { nightlyRevenue: '1000.00', taxeSejourAmount: '40.00' });
      const missing = (await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/tax-reports/2026-03/missing`).expect(200)).body;
      expect(missing.problems).toEqual(expect.arrayContaining([{ code: 'NO_AMOUNTS', bookingId: bare.id }, { code: 'TAXE_SEJOUR_MISSING', bookingId: bare.id }]));
      expect(missing.stays[bare.id]).toBeDefined();
      expect(JSON.stringify(missing)).not.toContain('Secret');
      const mar = (await generate().expect(200)).body;
      expect(mar.totals.taxeSejourDeducted).toBe(4_000);
      expect(mar.totals.grossBase).toBe(3_000_000 + 100_000 - 4_000);
      expect(withTs.id).toBeDefined();
    });

    it('computes VAT for a professional property and says the income-tax rule is missing', async () => {
      await t.prisma.property.update({ where: { id: propertyId }, data: { taxRegime: 'PROFESSIONAL' } });
      const mar = (await generate().expect(200)).body;
      expect(mar.totals.vatTotal).toBe(272_727); // 10 % tax-inclusive: 3 000 000 x 1000 / 11000 = 272 727.27
      expect(line(mar, 'income_tax')).toMatchObject({ amount: null, note: 'rule_missing' });
    });

    it('adds a statement for a non-resident owner', async () => {
      await t.prisma.propertyOwner.update({ where: { id: ownerId }, data: { residency: 'MRE', bankAccountType: 'CONVERTIBLE_DIRHAM' } });
      const mar = (await generate().expect(200)).body;
      expect(line(mar, 'nonresident_statement')).toMatchObject({ amount: null, note: 'residency' });
      expect((await t.prisma.taxReport.findFirstOrThrow()).bankAccountType).toBe('CONVERTIBLE_DIRHAM');
    });

    it('is not computed, and still generated, when a rule is missing; refused when the disclaimer is missing', async () => {
      await t.prisma.ruleConfig.delete({ where: { key: 'tax.property_income' } });
      const mar = (await generate().expect(200)).body;
      expect(line(mar, 'income_tax')).toMatchObject({ amount: null, note: 'rule_missing' });
      expect(mar.problemCounts.RULE_MISSING).toBeGreaterThan(0);

      const objects = await t.prisma.storedObject.count();
      await t.prisma.ruleConfig.delete({ where: { key: 'tax.disclaimer.beta.fr' } });
      expect((await generate('2026-02').expect(503)).body.error.code).toBe('DISCLAIMER_MISSING');
      expect(await t.prisma.storedObject.count()).toBe(objects); // nothing was stored
    });

    it('a stay with only a commission or Taxe de séjour entered has amounts, but an incomplete month is still a beta', async () => {
      await seedTaxRules(t.prisma, { validatedBy: 'Fiduciaire X' });
      await t.prisma.taxRule.create({ data: { commune: 'Marrakech', licenseType: 'RIAD', taxeSejourRate: '20.00', tptRate: '2.50', effectiveFrom: new Date('2025-01-01'), validatedBy: 'Fiduciaire X', validatedAt: new Date('2026-10-01') } });
      expect((await generate().expect(200)).body.beta).toBe(false); // every rule validated, every stay complete
      await stay(a.accountId, propertyId, '2026-03-20', '2026-03-22'); // no amounts at all
      const mar = (await generate().expect(200)).body;
      expect(mar.beta).toBe(true);
      expect(mar.problemCounts.NO_AMOUNTS).toBe(1);
      const withCommissionOnly = await stay(a.accountId, propertyId, '2026-03-23', '2026-03-24', { platformCommission: '10.00' });
      const missing = (await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/tax-reports/2026-03/missing`).expect(200)).body;
      expect(missing.problems.filter((p: { bookingId?: string }) => p.bookingId === withCommissionOnly.id)).toEqual([]);
    });

    it('adds up only properties under the same income regime for the owner’s rate', async () => {
      const pro = await property(a.accountId, ownerId, { name: 'Professional one', taxRegime: 'PROFESSIONAL' });
      await stay(a.accountId, pro.id, '2026-01-05', '2026-01-08', { nightlyRevenue: '900000.00' });
      const mar = (await generate().expect(200)).body;
      expect(line(mar, 'income_tax')).toMatchObject({ amount: 1_000_000, note: 'catch_up' }); // as if the professional property did not exist
    });

    it('refuses totals that would overflow the money columns', async () => {
      for (let i = 0; i < 12; i++) await stay(a.accountId, propertyId, '2026-03-11', '2026-03-12', { nightlyRevenue: '999999999.00' });
      const res = await generate().expect(422);
      expect(res.body.error.code).toBe('REPORT_TOO_LARGE');
      expect(await t.prisma.storedObject.count()).toBe(0);
    });

    it('refuses a malformed month, a month that has not started, and a property of another account', async () => {
      await generate('2026-13').expect(400);
      await generate('abc').expect(400);
      expect((await generate('2099-01').expect(422)).body.error.code).toBe('MONTH_NOT_STARTED');
      await generate('2026-03', b.as.OWNER_MANAGER).expect(404);
      expect(await t.prisma.taxReport.count()).toBe(0);
    });
  });

  describe('the exports', () => {
    it('carry the beta watermark and the disclaimer on every page while a rule is unvalidated', async () => {
      const { id } = (await generate().expect(200)).body;
      const pdf = await download(id, 'pdf').expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['cache-control']).toBe('no-store');
      expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
      const words = text(pdf.body);
      expect(words).toContain(BETA);
      expect(words).toContain('ESTIMATION BÊTA - NON VÉRIFIÉE');
      expect(words).toContain('has NOT been validated by a licensed accountant');
      expect(words).toContain('10 000,00'); // the income tax, in centimes formatted for reading
      expect(words).toMatch(/NON VALIDÉE \/ UNVALIDATED/);
      expect(words.toLowerCase()).not.toMatch(/certifi|garanti|guaranteed|compliant|conforme/);
      expect(words).not.toContain('Secret Owner Name'); // the owner is not on the estimate

      const xlsx = await download(id, 'xlsx').expect(200);
      expect(xlsx.headers['content-disposition']).toMatch(/^attachment/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.body as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Report', 'Rules']);
      for (const ws of wb.worksheets) {
        expect(String(ws.getCell('A1').value)).toContain(BETA);
        expect(ws.getCell('A1').font?.size).toBeGreaterThanOrEqual(24);
        expect(String(ws.getCell('A2').value)).toContain('NOT been validated by a licensed accountant');
        expect(ws.headerFooter.oddHeader).toContain(BETA);
        expect(ws.headerFooter.oddFooter).toContain('NOT been validated');
        ws.eachRow((row) => row.eachCell((cell) => expect(typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value).toBe(false))); // values only
      }
      const rows: Record<string, unknown> = {};
      wb.getWorksheet('Report')!.eachRow((row) => (rows[String(row.getCell(1).value)] = row.getCell(2).value));
      expect(rows['Base brute / Gross base']).toBe(30000);
      expect(rows["Impôt sur le revenu (estimation) / Income tax (estimate)"]).toBe(10000);
    });

    it('have no watermark and the standard wording once every rule in use is validated', async () => {
      await seedTaxRules(t.prisma, { validatedBy: 'Fiduciaire X' });
      await t.prisma.taxRule.create({ data: { commune: 'Marrakech', licenseType: 'RIAD', taxeSejourRate: '20.00', tptRate: '2.50', effectiveFrom: new Date('2025-01-01'), validatedBy: 'Fiduciaire X', validatedAt: new Date('2026-10-01') } });
      const mar = (await generate().expect(200)).body;
      expect(mar.beta).toBe(false);
      expect(line(mar, 'local_tax').amount).toBe(2 * 5 * 250); // 2 guests x 5 nights x 2.50 MAD
      const words = text((await download(mar.id, 'pdf').expect(200)).body);
      expect(words).not.toContain(BETA);
      expect(words).toContain('Estimate only - confirm with your accountant.');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await download(mar.id, 'xlsx').expect(200)).body as unknown as ExcelJS.Buffer);
      expect(String(wb.getWorksheet('Report')!.getCell('A1').value)).toBe('Estimate only - confirm with your accountant.');
      expect(wb.getWorksheet('Report')!.headerFooter.oddHeader).toBeUndefined();
    });

    it('neutralise text that looks like a formula', async () => {
      await t.prisma.property.update({ where: { id: propertyId }, data: { name: '=HYPERLINK("http://evil.test","x")' } });
      const { id } = (await generate().expect(200)).body;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await download(id, 'xlsx').expect(200)).body as unknown as ExcelJS.Buffer);
      const found: string[] = [];
      wb.getWorksheet('Report')!.eachRow((row) => row.eachCell((cell) => typeof cell.value === 'string' && cell.value.includes('HYPERLINK') && found.push(cell.value)));
      expect(found.length).toBeGreaterThan(0);
      for (const v of found) expect(v.startsWith("'=")).toBe(true); // prefixed, so a spreadsheet reads it as text
      const html = text((await download(id, 'pdf').expect(200)).body);
      expect(html).toContain('HYPERLINK'); // shown as text
    });

    it('are not handed out once the report is out of date, whoever asks', async () => {
      const { id } = (await generate().expect(200)).body;
      await download(id, 'pdf').expect(200);
      await t.prisma.ruleConfig.update({ where: { key: 'tax.vat' }, data: { validatedBy: 'Somebody', validatedAt: new Date() } }); // a rule changed status
      const property = await t.prisma.property.findFirstOrThrow();
      await t.prisma.property.update({ where: { id: property.id }, data: { taxRegime: 'PROFESSIONAL' } });
      for (const who of [a.as.OWNER_MANAGER, a.as.ACCOUNTANT]) {
        const res = await who.get(`/api/tax/reports/${id}/pdf`);
        expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 409, code: 'REPORT_OUTDATED' });
        expect((await who.get(`/api/tax/reports/${id}/xlsx`)).status).toBe(409);
      }
      expect(await t.prisma.auditLog.count({ where: { action: 'tax.export.read' } })).toBe(1); // the refused reads wrote nothing and returned nothing
    });

    it('are read only after the audit row is written, and never when it cannot be', async () => {
      const { id } = (await generate().expect(200)).body;
      await download(id, 'pdf').expect(200);
      await download(id, 'xlsx').expect(200);
      const reads = await t.prisma.auditLog.findMany({ where: { action: 'tax.export.read' } });
      expect(reads.map((r) => [r.actorId, r.resourceType, r.resourceId])).toEqual([[a.users.OWNER_MANAGER.id, 'TaxReport', id], [a.users.OWNER_MANAGER.id, 'TaxReport', id]]);
      jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValue(new Error('audit down'));
      const res = await download(id, 'pdf');
      expect(res.status).toBe(500);
      expect(res.body.subarray(0, 5).toString()).not.toBe('%PDF-');
    });
  });

  describe('regenerating and staleness', () => {
    it('turns outdated when an amount changes, and regenerating replaces the pair of files', async () => {
      const first = (await generate().expect(200)).body;
      expect((await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/tax-reports`).expect(200)).body.months.find((m: { month: string }) => m.month === '2026-03').status).toBe('generated');
      const bookingId = (await t.prisma.booking.findFirstOrThrow({ where: { addonRevenue: { not: null } } })).id;
      await a.as.OWNER_MANAGER.patch(`/api/bookings/${bookingId}/amounts`, { addonRevenue: '900.00' }).expect(200);
      expect((await a.as.OWNER_MANAGER.get(`/api/tax/reports/${first.id}`).expect(200)).body.status).toBe('outdated');

      const second = (await generate().expect(200)).body;
      expect(second.id).toBe(first.id);
      expect(second.status).toBe('generated');
      expect(second.totals.addonRevenue).toBe(90_000);
      expect(await t.prisma.taxReport.count()).toBe(1);
      expect(await t.prisma.storedObject.count({ where: { deletedAt: null, kind: { in: ['TAX_REPORT_PDF', 'TAX_REPORT_XLSX'] } } })).toBe(2);
      expect(store.keys()).toHaveLength(2);
      expect(await t.prisma.auditLog.count({ where: { action: 'tax.report.generated' } })).toBe(2);
    });

    it('turns outdated when a rule changes', async () => {
      const { id } = (await generate().expect(200)).body;
      await t.prisma.ruleConfig.update({ where: { key: 'tax.property_income' }, data: { value: { thresholdCentimes: 12_000_000, belowBps: 1000, aboveBps: 2000, mode: 'WHOLE' } } });
      expect((await a.as.OWNER_MANAGER.get(`/api/tax/reports/${id}`).expect(200)).body.status).toBe('outdated');
    });

    it('survives parallel generation for the same month with no file left behind', async () => {
      const results = await Promise.all([generate(), generate(), generate()]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(await t.prisma.taxReport.count()).toBe(1);
      expect(await t.prisma.storedObject.count({ where: { deletedAt: null } })).toBe(2);
      expect(store.keys()).toHaveLength(2);
    });

    it('leaves nothing a retention run cannot reach when the row cannot be written', async () => {
      const storage = t.app.get(StorageService);
      const put = storage.put.bind(storage);
      jest.spyOn(storage, 'put').mockImplementation(async (...args) => {
        expect(args[3]?.expiresAt?.getTime()).toBeGreaterThan(Date.now()); // provisional from the start
        return put(...args);
      });
      jest.spyOn(t.prisma, '$transaction').mockRejectedValue(new Error('db down'));
      expect((await generate()).status).toBe(500);
      jest.restoreAllMocks();
      expect(await t.prisma.taxReport.count()).toBe(0);
      expect(await t.prisma.storedObject.count({ where: { deletedAt: null } })).toBe(0); // shredded at once
    });
  });

  describe('the report list', () => {
    it('can be narrowed by year and property, and says when it is cut short', async () => {
      await generate('2026-02').expect(200);
      await generate('2026-03').expect(200);
      const other = await property(a.accountId, ownerId, { name: 'Second riad' });
      await stay(a.accountId, other.id, '2025-12-05', '2025-12-08', { nightlyRevenue: '100.00' });
      await generate('2025-12', a.as.OWNER_MANAGER, other.id).expect(200);
      const all = await a.as.ACCOUNTANT.get('/api/tax/reports').expect(200);
      expect(all.body.map((r: { month: string }) => r.month)).toEqual(['2026-03', '2026-02', '2025-12']);
      expect(all.headers['x-truncated']).toBeUndefined();
      expect((await a.as.ACCOUNTANT.get('/api/tax/reports?year=2026').expect(200)).body).toHaveLength(2);
      expect((await a.as.ACCOUNTANT.get(`/api/tax/reports?propertyId=${other.id}`).expect(200)).body).toHaveLength(1);
      await a.as.ACCOUNTANT.get('/api/tax/reports?year=1999').expect(400);
      await a.as.ACCOUNTANT.get('/api/tax/reports?propertyId=nope').expect(400);
      await a.as.ACCOUNTANT.get('/api/tax/reports?other=1').expect(400);
    });
  });

  describe('the Accountant', () => {
    it('reads reports and exports, sees no owner, address, stay id or guest, and cannot generate or edit', async () => {
      await stay(a.accountId, propertyId, '2026-03-20', '2026-03-22'); // a stay without amounts: a problem for the manager
      const { id } = (await generate().expect(200)).body;
      const acc = a.as.ACCOUNTANT;
      const list = (await acc.get('/api/tax/reports').expect(200)).body;
      const detail = (await acc.get(`/api/tax/reports/${id}`).expect(200)).body;
      const rules = (await acc.get('/api/tax/rules').expect(200)).body;
      const everything = JSON.stringify([list, detail, rules]);
      for (const secret of ['Secret Owner Name', '1 rue Secrète', ownerId, a.users.OWNER_MANAGER.email]) expect(everything).not.toContain(secret);
      expect(list[0]).toMatchObject({ id, propertyName: 'Riad Test', month: '2026-03', beta: true });
      expect(list[0]).not.toHaveProperty('problems');
      expect(detail.problems).toBeUndefined();
      expect(detail.problemCounts).toBeDefined();
      expect((await download(id, 'pdf', acc)).status).toBe(200);
      expect((await download(id, 'xlsx', acc)).status).toBe(200);
      const reader = (await t.prisma.auditLog.findMany({ where: { action: 'tax.export.read', actorId: a.users.ACCOUNTANT.id } })).length;
      expect(reader).toBe(2);
      await generate('2026-03', acc).expect(403);
      await acc.get(`/api/properties/${propertyId}`).expect(403);
      await acc.get(`/api/properties/${propertyId}/bookings`).expect(403);
      await acc.patch('/api/bookings/11111111-1111-4111-8111-111111111111/amounts', { nightlyRevenue: '1.00' }).expect(403);
    });

    it('Staff have no access to any tax route', async () => {
      const { id } = (await generate().expect(200)).body;
      for (const url of ['/api/tax/rules', '/api/tax/reports', `/api/tax/reports/${id}`, `/api/tax/reports/${id}/pdf`, `/api/properties/${propertyId}/tax-reports`]) await a.as.STAFF.get(url).expect(403);
    });

    it('another account sees no report at all', async () => {
      const { id } = (await generate().expect(200)).body;
      expect((await b.as.OWNER_MANAGER.get('/api/tax/reports').expect(200)).body).toEqual([]);
      await b.as.OWNER_MANAGER.get(`/api/tax/reports/${id}`).expect(404);
      await b.as.ACCOUNTANT.get(`/api/tax/reports/${id}/pdf`).expect(404);
    });
  });

  describe('stay amounts', () => {
    let bookingId: string;
    beforeEach(async () => {
      bookingId = (await stay(a.accountId, propertyId, '2026-04-01', '2026-04-03')).id;
    });
    const patch = (body: object, who = a.as.OWNER_MANAGER) => who.patch(`/api/bookings/${bookingId}/amounts`, body);

    it('sets, changes and clears figures, keeping decimals exact, and audits by id without the amounts', async () => {
      const res = (await patch({ nightlyRevenue: '1234.50', cleaningFee: '0.07', partySize: 3 }).expect(200)).body;
      expect(res).toMatchObject({ nightlyRevenue: '1234.5', cleaningFee: '0.07', partySize: 3 });
      await patch({ cleaningFee: null }).expect(200);
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).cleaningFee).toBeNull();
      expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).nightlyRevenue!.toFixed(2)).toBe('1234.50');
      const audit = JSON.stringify(await t.prisma.auditLog.findMany({ where: { action: 'booking.amounts.updated' } }));
      expect(audit).toContain(bookingId);
      expect(audit).not.toContain('1234');
    });

    it('refuses floats, negatives, exponents, extra decimals, unknown fields and an empty change', async () => {
      for (const bad of [{ nightlyRevenue: 12.5 }, { nightlyRevenue: '-5.00' }, { nightlyRevenue: '1e3' }, { nightlyRevenue: '1.234' }, { nightlyRevenue: '1 000' }, { nightlyRevenue: '1234567890' }, { partySize: 0 }, { partySize: 1.5 }, { accountId: b.accountId }, { classification: 'OWNER_BLOCK' }]) {
        expect({ bad, status: (await patch(bad)).status }).toEqual({ bad, status: 400 });
      }
      expect((await patch({}).expect(400)).body.error.code).toBe('NO_CHANGE');
    });
  });

  describe('the flag', () => {
    it('answers 404 on every tax route when TAX_REPORTS_ENABLED is off, but the amounts route stays', async () => {
      const off = await createTestApp({ env: { TAX_REPORTS_ENABLED: 'false' } });
      try {
        await resetDatabase(off.prisma, off.redis);
        const acc = await seedAccount(off, 'Gamma');
        const id = '11111111-1111-4111-8111-111111111111';
        for (const url of ['/api/tax/rules', '/api/tax/reports', `/api/tax/reports/${id}`, `/api/tax/reports/${id}/pdf`, `/api/tax/reports/${id}/xlsx`, `/api/properties/${id}/tax-reports`, `/api/properties/${id}/tax-reports/2026-03/missing`]) {
          await acc.as.OWNER_MANAGER.get(url).expect(404);
          if (url.includes('/tax/')) await acc.as.ACCOUNTANT.get(url).expect(404); // the Accountant may not reach the property routes at all (403)
        }
        await acc.as.OWNER_MANAGER.post(`/api/properties/${id}/tax-reports/2026-03`).expect(404);
        await acc.as.OWNER_MANAGER.patch(`/api/bookings/${id}/amounts`, { nightlyRevenue: '1.00' }).expect(404); // no such booking, not a flag answer
      } finally {
        await off.app.close();
      }
    });
  });

  it('the guard on the tax controller is reached before anything is stored (renderer unavailable)', async () => {
    jest.spyOn(t.app.get(PdfRenderer), 'render').mockRejectedValue(Object.assign(new Error('x'), { name: 'PdfUnavailableError' }));
    const res = await generate();
    expect([500, 503]).toContain(res.status);
    expect(await t.prisma.storedObject.count()).toBe(0);
  });
});
