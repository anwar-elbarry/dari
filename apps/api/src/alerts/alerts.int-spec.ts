import { DAY_COUNTER_RULE_KEY } from '../compliance/rules.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

describe('threshold alerts and dashboard (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let propertyId: string;
  const year = new Date().getUTCFullYear();

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    t.mail.sent.length = 0;
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    await t.prisma.ruleConfig.upsert({
      where: { key: DAY_COUNTER_RULE_KEY },
      update: { value: { amber: 5, red: 8, cap: 10, period: 'CALENDAR_YEAR' }, validatedBy: null },
      create: { key: DAY_COUNTER_RULE_KEY, value: { amber: 5, red: 8, cap: 10, period: 'CALENDAR_YEAR' } },
    });
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'O', residency: 'RESIDENT' } });
    propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad Yasmine', address: 'x', commune: 'Marrakech', licenseType: 'RIAD', licenseStatus: 'UNLICENSED' } })).id;
  });

  const csv = (from: number, to: number, code: string) => `check_in,check_out,platform,confirmation_code\n${year}-03-${String(from).padStart(2, '0')},${year}-03-${String(to).padStart(2, '0')},AIRBNB,${code}\n`;
  const importCsv = (text: string) => a.as.OWNER_MANAGER.upload(`/api/properties/${propertyId}/imports`, text).expect(201);
  const alerts = () => t.prisma.notification.findMany({ orderBy: { type: 'asc' } });

  it('raises the early warning once, by dashboard and by email to managers only', async () => {
    await importCsv(csv(1, 5, 'A')); // 4 nights
    expect(await alerts()).toHaveLength(0);
    await importCsv(csv(10, 12, 'B')); // 6 nights → amber

    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'day_counter.amber', severity: 'AMBER', propertyId, year, sentVia: ['dashboard', 'email'], resolvedAt: null });
    expect(rows[0].message).toContain('6 nights');
    expect(t.mail.sent.map((m) => m.to)).toEqual([a.users.OWNER_MANAGER.email]);
    expect(t.mail.sent[0].subject).toContain('Riad Yasmine');
    expect(t.mail.sent[0].text).toContain('pas encore été confirmés');

    await importCsv(csv(20, 21, 'C')); // 7 nights: still amber, no second alert or email
    expect(await alerts()).toHaveLength(1);
    expect(t.mail.sent).toHaveLength(1);
  });

  it('raises the critical alert separately, and one email when both thresholds are crossed at once', async () => {
    await importCsv(csv(1, 10, 'BIG')); // 9 nights: amber and red together
    const rows = await alerts();
    expect(rows.map((r) => r.type)).toEqual(['day_counter.amber', 'day_counter.red']);
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0].subject).toContain('critique');
  });

  it('follows reclassification: confirming an uncertain stay can trigger the alert', async () => {
    const b1 = await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(`${year}-04-01`), checkOut: new Date(`${year}-04-09`), source: 'BOOKING', classification: 'UNCERTAIN' } });
    expect(await alerts()).toHaveLength(0);
    await a.as.OWNER_MANAGER.patch(`/api/bookings/${b1.id}/classification`, { classification: 'BOOKING' }).expect(200);
    expect((await alerts()).map((r) => r.type)).toEqual(['day_counter.amber', 'day_counter.red']);
  });

  it('never alerts for licensed properties, and evaluateAll is idempotent', async () => {
    await t.prisma.property.update({ where: { id: propertyId }, data: { licenseStatus: 'LICENSED' } });
    await importCsv(csv(1, 12, 'L'));
    expect(await alerts()).toHaveLength(0);

    await t.prisma.property.update({ where: { id: propertyId }, data: { licenseStatus: 'UNLICENSED' } });
    const svc = t.app.get((await import('./alerts.service')).AlertsService);
    expect(await svc.evaluateAll()).toBe(2);
    expect(await svc.evaluateAll()).toBe(0);
    expect(t.mail.sent).toHaveLength(1);
  });

  it('lists alerts for Staff but only Owner/Manager can resolve them; other accounts see nothing', async () => {
    await importCsv(csv(1, 10, 'BIG'));
    const staff = await a.as.STAFF.get('/api/alerts').expect(200);
    expect(staff.body).toHaveLength(2);
    expect(Object.keys(staff.body[0]).sort()).toEqual(['createdAt', 'id', 'message', 'propertyId', 'readAt', 'resolvedAt', 'severity', 'type', 'year']);

    const id = staff.body[0].id;
    await a.as.STAFF.patch(`/api/alerts/${id}`).expect(403);
    const done = await a.as.OWNER_MANAGER.patch(`/api/alerts/${id}`).expect(200);
    expect(done.body.resolvedAt).not.toBeNull();
    await a.as.OWNER_MANAGER.patch(`/api/alerts/${id}`).expect(404); // already resolved
    expect((await a.as.OWNER_MANAGER.get('/api/dashboard').expect(200)).body.alerts).toHaveLength(1);
    expect((await b.as.OWNER_MANAGER.get('/api/alerts').expect(200)).body).toEqual([]);
    expect(await t.prisma.auditLog.count({ where: { action: 'alert.resolved' } })).toBe(1);

    // A resolved alert is not raised again for the same year.
    await importCsv(csv(25, 26, 'MORE'));
    expect(await alerts()).toHaveLength(2);
  });

  it('dashboard: cards with counters, totals, thresholds; Staff get no tax data or feed status', async () => {
    await importCsv(csv(1, 7, 'D')); // 6 nights → amber
    await t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(`${year}-09-01`), checkOut: new Date(`${year}-09-03`), source: 'BOOKING', classification: 'UNCERTAIN' } });

    const m = (await a.as.OWNER_MANAGER.get('/api/dashboard').expect(200)).body;
    expect(m).toMatchObject({ year, thresholds: { amber: 5, red: 8, cap: 10 }, rulesValidated: false, totals: { properties: 1, atRisk: 1, pendingReview: 1 } });
    expect(m.properties[0]).toMatchObject({ name: 'Riad Yasmine', taxRegime: 'PROPERTY_INCOME', counter: { applies: true, nights: 6, level: 'amber', pendingReview: 1 }, feedProblems: 0 });

    const s = (await a.as.STAFF.get('/api/dashboard').expect(200)).body;
    expect(s.properties[0].counter.nights).toBe(6);
    expect(s.properties[0]).not.toHaveProperty('taxRegime');
    expect(s.properties[0]).not.toHaveProperty('feedProblems');
  });

  it('counts feed problems for managers', async () => {
    await t.prisma.icalFeed.create({ data: { accountId: a.accountId, propertyId, platform: 'AIRBNB', url: 'https://93.184.216.34/a.ics', lastStatus: 'ERROR', lastError: 'x' } });
    const m = (await a.as.OWNER_MANAGER.get('/api/dashboard').expect(200)).body;
    expect(m.properties[0].feedProblems).toBe(1);
  });
});
