import { DAY_COUNTER_RULE_KEY } from './rules.service';
import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

describe('day counter (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
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
    a = await seedAccount(t, 'Alpha');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'O', residency: 'RESIDENT' } });
    propertyId = (await t.prisma.property.create({ data: { accountId: a.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD', licenseStatus: 'UNLICENSED' } })).id;
    await t.prisma.ruleConfig.upsert({
      where: { key: DAY_COUNTER_RULE_KEY },
      update: { value: { amber: 90, red: 110, cap: 120, period: 'CALENDAR_YEAR' }, validatedBy: null },
      create: { key: DAY_COUNTER_RULE_KEY, value: { amber: 90, red: 110, cap: 120, period: 'CALENDAR_YEAR' } },
    });
  });

  const stay = (checkIn: string, checkOut: string, extra: object = {}) =>
    t.prisma.booking.create({ data: { accountId: a.accountId, propertyId, checkIn: new Date(checkIn), checkOut: new Date(checkOut), source: 'AIRBNB', nightlyRevenue: 1000, ...extra } });

  it('counts confirmed stays only, once per night, within the year', async () => {
    await stay(`${year}-02-01`, `${year}-02-11`); // 10
    await stay(`${year}-02-05`, `${year}-02-15`); // +4 (overlap)
    await stay(`${year - 1}-12-30`, `${year}-01-02`); // +1 in this year
    await stay(`${year}-03-01`, `${year}-03-06`, { status: 'CANCELLED' }); // 0
    await stay(`${year}-04-01`, `${year}-04-06`, { classification: 'OWNER_BLOCK' }); // 0, 5 block nights
    await stay(`${year}-05-01`, `${year}-05-04`, { classification: 'UNCERTAIN' }); // 0, 3 uncertain

    const res = await a.as.STAFF.get(`/api/properties/${propertyId}/day-counter?year=${year}`).expect(200);
    expect(res.body).toMatchObject({
      year,
      applies: true,
      nights: 15,
      level: 'green',
      thresholds: { amber: 90, red: 110, cap: 120 },
      rulesValidated: false,
      projectedBreachDate: null,
      pendingReview: 1,
      uncertainNights: 3,
      ownerBlockNights: 5,
    });
  });

  it('uses thresholds from RuleConfig and projects the breach date', async () => {
    await t.prisma.ruleConfig.update({ where: { key: DAY_COUNTER_RULE_KEY }, data: { value: { amber: 5, red: 8, cap: 10, period: 'CALENDAR_YEAR' }, validatedBy: 'Counsel' } });
    await stay(`${year}-06-01`, `${year}-06-07`); // 6 nights: 1..6 June
    await stay(`${year}-06-10`, `${year}-06-16`); // 6 nights: 10..15 June → 10th night is 13 June
    const res = await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/day-counter?year=${year}`).expect(200);
    expect(res.body).toMatchObject({ nights: 12, level: 'red', thresholds: { amber: 5, red: 8, cap: 10 }, rulesValidated: true, projectedBreachDate: `${year}-06-13` });
  });

  it('defaults to the current year, marks licensed properties as not applicable, and validates the year', async () => {
    await t.prisma.property.update({ where: { id: propertyId }, data: { licenseStatus: 'LICENSED' } });
    const res = await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/day-counter`).expect(200);
    expect(res.body).toMatchObject({ year, applies: false, nights: 0 });
    await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/day-counter?year=1999`).expect(400);
  });

  it('lists stays with revenue for managers only and filters by date', async () => {
    await stay(`${year}-02-01`, `${year}-02-04`);
    await stay(`${year}-07-01`, `${year}-07-04`);
    const manager = await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/bookings?from=${year}-06-01&to=${year}-08-01`).expect(200);
    expect(manager.body).toHaveLength(1);
    expect(manager.body[0]).toMatchObject({ nightlyRevenue: '1000', classification: 'BOOKING' });

    const staff = await a.as.STAFF.get(`/api/properties/${propertyId}/bookings`).expect(200);
    expect(staff.body).toHaveLength(2);
    expect(Object.keys(staff.body[0])).not.toEqual(expect.arrayContaining(['nightlyRevenue', 'cleaningFee', 'confirmationCode']));
    await a.as.STAFF.get(`/api/properties/${propertyId}/bookings?from=nope`).expect(400);
  });

  it('records a manual classification, which changes the count and is audited', async () => {
    const b = await stay(`${year}-02-01`, `${year}-02-04`, { classification: 'UNCERTAIN' });
    expect((await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/day-counter?year=${year}`)).body.nights).toBe(0);

    const res = await a.as.OWNER_MANAGER.patch(`/api/bookings/${b.id}/classification`, { classification: 'BOOKING' }).expect(200);
    expect(res.body).toMatchObject({ classification: 'BOOKING', classifiedBy: 'MANUAL' });
    expect((await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/day-counter?year=${year}`)).body.nights).toBe(3);
    await a.as.OWNER_MANAGER.patch(`/api/bookings/${b.id}/classification`, { classification: 'UNCERTAIN' }).expect(400);
    expect(await t.prisma.auditLog.count({ where: { action: 'booking.classified' } })).toBe(1);
  });

  it('refuses impossible dates in the stays filter and never returns the stored event summary', async () => {
    await stay(`${year}-02-01`, `${year}-02-04`, { summary: 'Reserved — Jean Dupont' });
    await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/bookings?from=2026-13-45`).expect(400);
    await a.as.OWNER_MANAGER.get(`/api/properties/${propertyId}/bookings?to=not-a-date`).expect(400);
    for (const c of [a.as.OWNER_MANAGER, a.as.STAFF]) {
      const res = await c.get(`/api/properties/${propertyId}/bookings`).expect(200);
      expect(JSON.stringify(res.body)).not.toContain('Dupont');
      expect(res.body[0]).not.toHaveProperty('summary');
    }
  });
});
