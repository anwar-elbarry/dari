import ExcelJS from 'exceljs';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';
import { seedTaxRules } from '../test/tax-fixtures';

requireDatabase();

function binary(res: import('supertest').Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
async function sheets(xlsx: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
  const text = (name: string) => {
    const out: string[] = [];
    wb.getWorksheet(name)!.eachRow((row) => row.eachCell((c) => out.push(String(c.value))));
    return out.join(' | ');
  };
  return { names: wb.worksheets.map((w) => w.name), text, wb };
}

interface Month {
  month: string;
  stays: number;
  nights: number;
  figures: Record<string, number | null>;
  report: string;
  beta: boolean;
}
interface Property {
  propertyId: string;
  propertyName: string;
  ownerName: string;
  months: Month[];
  summary: { figures: Record<string, number | null>; reportsCurrent: number; months: number };
}

describe('tax portfolio export (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let riad: string;
  let dar: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  const property = (owner: string, name: string, over: Record<string, unknown> = {}) =>
    t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner, name, address: '1 rue Secrète', commune: 'Marrakech', licenseType: 'RIAD', ...over } });
  const stay = (propId: string, checkIn: string, checkOut: string, amounts: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
    t.prisma.booking.create({ data: { accountId: a.accountId, propertyId: propId, checkIn: new Date(checkIn), checkOut: new Date(checkOut), source: 'DIRECT', partySize: 2, ...amounts, ...over } });
  const portfolio = (query: string, who = a.as.OWNER_MANAGER) => who.get(`/api/tax/portfolio?${query}`);
  const download = (query: string, who = a.as.OWNER_MANAGER) => who.get(`/api/tax/portfolio/xlsx?${query}`).buffer(true).parse(binary);

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    await seedTaxRules(t.prisma);
    const alice = (await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Alice Secret-Owner', residency: 'RESIDENT' } })).id;
    const bruno = (await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Bruno Owner', residency: 'RESIDENT' } })).id;
    riad = (await property(alice, 'Riad Jasmin')).id;
    dar = (await property(bruno, '=HYPERLINK("http://x")', { taxeSejourMode: 'INCLUDED' })).id;
    await stay(riad, '2026-01-05', '2026-01-10', { nightlyRevenue: '60000.00' });
    await stay(riad, '2026-02-08', '2026-02-12', { nightlyRevenue: '49800.00', cleaningFee: '200.00' });
    await stay(riad, '2026-03-05', '2026-03-10', { nightlyRevenue: '29500.00', addonRevenue: '500.00' });
    await stay(riad, '2026-03-11', '2026-03-13', { nightlyRevenue: '99999.00' }, { status: 'CANCELLED' });
    await stay(dar, '2026-03-02', '2026-03-05', { nightlyRevenue: '3000.00', taxeSejourAmount: '120.00' });
  });

  it('gives each property month by month with the monthly report figures, and the status of the stored report', async () => {
    jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 stub'));
    const monthly = (await a.as.OWNER_MANAGER.post(`/api/properties/${riad}/tax-reports/2026-03`).expect(200)).body;

    const body = (await portfolio('year=2026&month=3').expect(200)).body as { months: string[]; beta: boolean; properties: Property[]; total: { figures: Record<string, number | null>; nights: number } };
    expect(body.months).toEqual(['2026-03']);
    expect(body.beta).toBe(true); // the seeded rules are unvalidated
    expect(body.properties.map((p) => p.ownerName)).toEqual(['Alice Secret-Owner', 'Bruno Owner']); // grouped by owner
    const r = body.properties.find((p) => p.propertyId === riad)!;
    expect(r.months[0]).toMatchObject({ month: '2026-03', stays: 1, nights: 5, report: 'generated', beta: true });
    // The same figures as the stored monthly estimate (the catch-up included), the cancelled stay left out.
    expect(r.months[0].figures.gross_base).toBe(monthly.totals.grossBase);
    expect(r.months[0].figures.income_tax).toBe(monthly.totals.incomeTaxTotal);
    expect(r.months[0].figures.local_tax).toBeNull(); // no TaxRule for the commune: not computed, never zero
    const d = body.properties.find((p) => p.propertyId === dar)!;
    expect(d.months[0]).toMatchObject({ stays: 1, nights: 3, report: 'none' });
    expect(d.months[0].figures.taxe_sejour_deducted).toBe(12_000); // included Taxe de séjour deducted
    expect(body.total.figures.gross_base).toBe(3_000_000 + 300_000 - 12_000);
    expect(body.total.figures.local_tax).toBeNull();
    expect(body.total.nights).toBe(8);

    // A changed amount: the figures follow the data, and the stored report is reported as out of date.
    const s = await t.prisma.booking.findFirstOrThrow({ where: { propertyId: riad, checkIn: new Date('2026-03-05') } });
    await a.as.OWNER_MANAGER.patch(`/api/bookings/${s.id}/amounts`, { nightlyRevenue: '30500.00' }).expect(200);
    const after = (await portfolio('year=2026&month=3').expect(200)).body as { properties: Property[] };
    expect(after.properties.find((p) => p.propertyId === riad)!.months[0]).toMatchObject({ report: 'outdated' });
    expect(after.properties.find((p) => p.propertyId === riad)!.months[0].figures.gross_base).toBe(3_100_000);
  });

  it('covers every month of a past year, and refuses a period that has not started or a malformed one', async () => {
    const body = (await portfolio('year=2025').expect(200)).body as { months: string[]; properties: Property[] };
    expect(body.months).toHaveLength(12);
    expect(body.properties[0].summary.months).toBe(12);
    expect(body.properties[0].summary.figures.gross_base).toBe(0);
    expect((await portfolio('year=2099').expect(422)).body.error.code).toBe('MONTH_NOT_STARTED');
    await portfolio('').expect(400);
    await portfolio('year=2026&month=13').expect(400);
    await portfolio('year=abc').expect(400);
    await portfolio('year=2026&owner=1').expect(400); // unknown fields are refused
  });

  it('gives the Accountant the owners but no address or booking id, and Staff nothing', async () => {
    const body = (await portfolio('year=2026&month=3', a.as.ACCOUNTANT).expect(200)).body as { properties: Property[] };
    expect(body.properties.map((p) => p.ownerName)).toEqual(['Alice Secret-Owner', 'Bruno Owner']); // the rate is per owner
    expect(JSON.stringify(body)).not.toMatch(/rue Secrète|bookingId|ownerId/);
    const { text } = await sheets((await download('year=2026&month=3', a.as.ACCOUNTANT).expect(200)).body);
    expect(text('Summary')).toContain('Alice Secret-Owner');
    expect(text('Months')).toContain('Bruno Owner');
    expect(text('Summary') + text('Months')).not.toContain('rue Secrète');
    await portfolio('year=2026', a.as.STAFF).expect(403);
    await download('year=2026', a.as.STAFF).expect(403);
  });

  it('exports an Excel file with the beta banner on every sheet, totals in centimes, safe text, and an audited read', async () => {
    const res = await download('year=2026&month=3').expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['cache-control']).toContain('no-store');
    const { names, text, wb } = await sheets(res.body);
    expect(names).toEqual(['Summary', 'Months', 'Rules']);
    for (const n of names) expect(text(n)).toContain('BETA ESTIMATE - UNVERIFIED');
    const summary = text('Summary');
    expect(summary).toContain('Alice Secret-Owner');
    expect(summary).toContain('Incluse dans le prix');
    expect(summary).toContain('non calculé / not computed'); // local taxes, never a zero
    expect(summary).toContain(`'=HYPERLINK`); // a name that looks like a formula stays text
    // No formula anywhere.
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));
    // The total row: 30 000 + 3 000 - 120 MAD of gross base.
    let total: ExcelJS.Row | undefined;
    wb.getWorksheet('Summary')!.eachRow((row) => {
      if (row.values && (row.values as unknown[]).includes('Total')) total = row;
    });
    expect((total!.values as unknown[]).includes(32_880)).toBe(true);
    expect(text('Months')).toContain('03/2026');
    expect(text('Rules')).toContain('NON VALIDÉE / UNVALIDATED');

    const audit = await t.prisma.auditLog.findMany({ where: { action: 'tax.portfolio.read' } });
    expect(audit).toEqual([expect.objectContaining({ accountId: a.accountId, actorId: a.users.OWNER_MANAGER.id, resourceType: 'TaxPortfolio', resourceId: '2026-03' })]);
    expect(await t.prisma.storedObject.count()).toBe(0); // built on request, never stored
  });

  it("shows nothing of another account's properties", async () => {
    const body = (await portfolio('year=2026', b.as.OWNER_MANAGER).expect(200)).body as { properties: Property[]; beta: boolean };
    expect(body.properties).toEqual([]);
    expect(body.beta).toBe(true);
    const { text } = await sheets((await download('year=2026', b.as.OWNER_MANAGER).expect(200)).body);
    expect(text('Summary')).not.toContain('Riad Jasmin');
  });

  it('refuses the export when the disclaimer text is missing', async () => {
    await t.prisma.ruleConfig.deleteMany({ where: { key: { startsWith: 'tax.disclaimer.beta' } } });
    expect((await a.as.OWNER_MANAGER.get('/api/tax/portfolio/xlsx?year=2026').expect(503)).body.error.code).toBe('DISCLAIMER_MISSING');
    expect(await t.prisma.auditLog.count({ where: { action: 'tax.portfolio.read' } })).toBe(0);
  });
});
