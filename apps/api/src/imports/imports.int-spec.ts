import { TEMPLATE_CSV } from './csv-import';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

const CSV = [
  'Arrivée;Départ;Plateforme;Référence;Voyageurs;Revenu;Ménage',
  '10/01/2026;14/01/2026;Airbnb;HM1;2;"3 200,00";250',
  '20/01/2026;22/01/2026;Booking.com;BK9;4;1800;150',
  '25/01/2026;25/01/2026;Airbnb;BAD;2;100;0',
  '01/02/2026;05/02/2026;;;2;2000;100',
].join('\n');

describe('CSV import (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let propertyId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'O', residency: 'RESIDENT' } });
    propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' } })).id;
  });

  const preview = (csv: string, fields: Record<string, string> = {}) => a.as.OWNER_MANAGER.upload(`/api/properties/${propertyId}/imports/preview`, csv, fields);
  const commit = (csv: string, fields: Record<string, string> = {}, c = a.as.OWNER_MANAGER) => c.upload(`/api/properties/${propertyId}/imports`, csv, fields, 'stays-2026.csv');

  it('serves the template', async () => {
    const res = await a.as.OWNER_MANAGER.get('/api/imports/template.csv').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toBe(TEMPLATE_CSV);
  });

  it('previews with suggested mapping, errors by line, and saves nothing', async () => {
    const res = await preview(CSV).expect(200);
    expect(res.body).toMatchObject({
      delimiter: ';',
      totalRows: 4,
      validRows: 3,
      alreadyImported: 0,
      errorCount: 1,
      errors: [{ line: 4, field: 'check_out', code: 'checkout_not_after_checkin' }],
      mapping: { Arrivée: 'check_in', Départ: 'check_out', Référence: 'confirmation_code' },
    });
    expect(res.body.preview[0]).toMatchObject({ line: 2, checkIn: '2026-01-10', platform: 'AIRBNB', amounts: { nightly_revenue: '3200.00', cleaning_fee: '250.00' } });
    expect(await t.prisma.booking.count()).toBe(0);
    expect(await t.prisma.importBatch.count()).toBe(0);
  });

  it('commits valid rows as bookings with revenue, once: a second upload adds nothing', async () => {
    const first = await commit(CSV).expect(201);
    expect(first.body).toMatchObject({ imported: 3, skippedExisting: 0, skippedWithErrors: 1 });

    const rows = await t.prisma.booking.findMany({ orderBy: { checkIn: 'asc' } });
    expect(rows.map((r) => [r.checkIn.toISOString().slice(0, 10), r.source, r.confirmationCode, r.classification, r.classifiedBy, r.nightlyRevenue?.toString()])).toEqual([
      ['2026-01-10', 'AIRBNB', 'HM1', 'BOOKING', 'MANUAL', '3200'],
      ['2026-01-20', 'BOOKING', 'BK9', 'BOOKING', 'MANUAL', '1800'],
      ['2026-02-01', 'DIRECT', 'import:2026-02-01:2026-02-05', 'BOOKING', 'MANUAL', '2000'],
    ]);
    expect(rows.every((r) => r.accountId === a.accountId && r.propertyId === propertyId && r.status === 'CONFIRMED')).toBe(true);
    const batch = await t.prisma.importBatch.findFirstOrThrow();
    expect(batch).toMatchObject({ fileName: 'stays-2026.csv', rowCount: 4, importedCount: 3, errorCount: 1, createdBy: a.users.OWNER_MANAGER.id });

    const again = await commit(CSV).expect(201);
    expect(again.body).toMatchObject({ imported: 0, skippedExisting: 3 });
    expect(await t.prisma.booking.count()).toBe(3);
    const prev = await preview(CSV).expect(200);
    expect(prev.body.alreadyImported).toBe(3);
    expect(await t.prisma.auditLog.count({ where: { action: 'import.committed' } })).toBe(2);
  });

  it('feeds the day counter through the imported stays', async () => {
    await commit(CSV).expect(201);
    const res = await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/day-counter?year=2026`).expect(200);
    expect(res.body.nights).toBe(4 + 2 + 4);
  });

  it('honours an explicit mapping and rejects unknown, duplicate or missing mappings', async () => {
    const csv = 'a,b,c\n2026-05-01,2026-05-03,120\n';
    const ok = await commit(csv, { mapping: JSON.stringify({ a: 'check_in', b: 'check_out', c: 'nightly_revenue' }) }).expect(201);
    expect(ok.body.imported).toBe(1);

    await preview(csv, { mapping: JSON.stringify({ a: 'check_in', b: 'nope' }) }).expect(400);
    await preview(csv, { mapping: JSON.stringify({ a: 'check_in', b: 'check_in' }) }).expect(400);
    const missing = await preview(csv, { mapping: JSON.stringify({ a: 'check_in' }) }).expect(400);
    expect(missing.body.error.code).toBe('MAPPING_INCOMPLETE');
    await preview(csv, { mapping: 'not json' }).expect(400);
    await preview(csv).expect(400); // no suggested mapping for a,b,c
  });

  it('refuses a missing file, an empty file, a file over 1 MB and an unknown property', async () => {
    await a.as.OWNER_MANAGER.post(`/api/properties/${propertyId}/imports/preview`, {}).expect(400);
    await preview('').expect(400);
    const big = 'check_in,check_out\n' + '2026-01-01,2026-01-03\n'.repeat(60_000);
    const res = await preview(big).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    await a.as.OWNER_MANAGER.upload('/api/properties/00000000-0000-4000-8000-000000000000/imports/preview', CSV).expect(404);
  });

  it("does not let another account import into this account's property", async () => {
    await b.as.OWNER_MANAGER.upload(`/api/properties/${propertyId}/imports`, CSV).expect(404);
    expect(await t.prisma.booking.count()).toBe(0);
  });

  it('never stores the guest-facing columns of a file it does not map', async () => {
    const csv = 'check_in,check_out,Guest name,Email\n2026-06-01,2026-06-03,Jean Dupont,jean@example.test\n';
    await commit(csv).expect(201);
    const dump = JSON.stringify(await t.prisma.booking.findMany());
    expect(dump).not.toContain('Dupont');
    expect(dump).not.toContain('jean@example.test');
  });

  it('treats mapping keys such as constructor and __proto__ as ordinary columns', async () => {
    const csv = 'constructor,__proto__,c\n2026-05-01,2026-05-03,120\n';
    const mapping = '{"constructor":"check_in","__proto__":"check_out","c":"nightly_revenue"}';
    const res = await commit(csv, { mapping }).expect(201);
    expect(res.body.imported).toBe(1);
    await preview('a,b\n1,2\n', { mapping: '{"a":"check_in","b":"__proto__"}' }).expect(400);
  });

  it('does not echo the submitted field name in mapping errors', async () => {
    const res = await preview('a,b\n2026-01-01,2026-01-03\n', { mapping: '{"a":"check_in","b":"secret-value-123"}' }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-value-123');
  });

  it('keeps two stays that share a reference on different platforms', async () => {
    const csv = 'check_in,check_out,platform,confirmation_code\n2026-01-01,2026-01-03,AIRBNB,SAME\n2026-02-01,2026-02-03,BOOKING,SAME\n';
    const first = await commit(csv).expect(201);
    expect(first.body).toMatchObject({ imported: 2, skippedExisting: 0 });
    expect(await t.prisma.booking.count()).toBe(2);
    expect((await commit(csv).expect(201)).body).toMatchObject({ imported: 0, skippedExisting: 2 });
  });

  it('stops reading a huge file early and refuses it', async () => {
    const rows = 'check_in,check_out\n' + '2026-01-01,2026-01-03\n'.repeat(5001);
    const started = Date.now();
    await preview(rows).expect(400);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
