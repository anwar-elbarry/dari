/**
 * Account isolation: a user of account B must never see or change account A's data.
 * Every route with an :id is attacked with A's ids from B's Owner/Manager (the most privileged role)
 * and must answer 404. Adding an :id route without a case here fails the completeness test.
 */
import { DiscoveryModule } from '@nestjs/core';
import { listRoutes } from '../test/routes';
import { StorageService } from '../storage/storage.service';
import { Client, createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

interface Ids {
  ownerId: string;
  propertyId: string;
  invitationId: string;
  feedId: string;
  bookingId: string;
  alertId: string;
  stayId: string;
  linkId: string;
  guestId: string;
}

const CASES: { method: string; route: string; call: (c: Client, ids: Ids) => Promise<{ status: number }> }[] = [
  { method: 'GET', route: '/api/property-owners/:id', call: (c, a) => c.get(`/api/property-owners/${a.ownerId}`) },
  { method: 'PATCH', route: '/api/property-owners/:id', call: (c, a) => c.patch(`/api/property-owners/${a.ownerId}`, { name: 'Hijacked' }) },
  { method: 'GET', route: '/api/properties/:id', call: (c, a) => c.get(`/api/properties/${a.propertyId}`) },
  { method: 'PATCH', route: '/api/properties/:id', call: (c, a) => c.patch(`/api/properties/${a.propertyId}`, { name: 'Hijacked' }) },
  { method: 'DELETE', route: '/api/invitations/:id', call: (c, a) => c.delete(`/api/invitations/${a.invitationId}`) },
  { method: 'GET', route: '/api/properties/:id/feeds', call: (c, a) => c.get(`/api/properties/${a.propertyId}/feeds`) },
  { method: 'POST', route: '/api/properties/:id/feeds', call: (c, a) => c.post(`/api/properties/${a.propertyId}/feeds`, { platform: 'DIRECT', url: 'https://93.184.216.34/x.ics' }) },
  { method: 'PATCH', route: '/api/properties/:id/feeds/:feedId', call: (c, a) => c.patch(`/api/properties/${a.propertyId}/feeds/${a.feedId}`, { url: 'https://93.184.216.34/y.ics' }) },
  { method: 'DELETE', route: '/api/properties/:id/feeds/:feedId', call: (c, a) => c.delete(`/api/properties/${a.propertyId}/feeds/${a.feedId}`) },
  { method: 'POST', route: '/api/properties/:id/feeds/:feedId/sync', call: (c, a) => c.post(`/api/properties/${a.propertyId}/feeds/${a.feedId}/sync`) },
  { method: 'GET', route: '/api/properties/:id/day-counter', call: (c, a) => c.get(`/api/properties/${a.propertyId}/day-counter`) },
  { method: 'GET', route: '/api/properties/:id/bookings', call: (c, a) => c.get(`/api/properties/${a.propertyId}/bookings`) },
  { method: 'PATCH', route: '/api/bookings/:id/classification', call: (c, a) => c.patch(`/api/bookings/${a.bookingId}/classification`, { classification: 'OWNER_BLOCK' }) },
  { method: 'PATCH', route: '/api/alerts/:id', call: (c, a) => c.patch(`/api/alerts/${a.alertId}`) },
  { method: 'POST', route: '/api/properties/:id/imports/preview', call: (c, a) => c.upload(`/api/properties/${a.propertyId}/imports/preview`, 'check_in,check_out\n2026-01-01,2026-01-03\n') },
  { method: 'POST', route: '/api/properties/:id/imports', call: (c, a) => c.upload(`/api/properties/${a.propertyId}/imports`, 'check_in,check_out\n2026-01-01,2026-01-03\n') },
  { method: 'POST', route: '/api/bookings/:id/checkin-links', call: (c, a) => c.post(`/api/bookings/${a.stayId}/checkin-links`) },
  { method: 'GET', route: '/api/bookings/:id/checkin-links', call: (c, a) => c.get(`/api/bookings/${a.stayId}/checkin-links`) },
  { method: 'DELETE', route: '/api/checkin-links/:id', call: (c, a) => c.delete(`/api/checkin-links/${a.linkId}`) },
  { method: 'POST', route: '/api/checkin-links/:id/resend', call: (c, a) => c.post(`/api/checkin-links/${a.linkId}/resend`) },
  { method: 'GET', route: '/api/properties/:id/arrivals', call: (c, a) => c.get(`/api/properties/${a.propertyId}/arrivals`) },
  { method: 'GET', route: '/api/guests/:id', call: (c, a) => c.get(`/api/guests/${a.guestId}`) },
  { method: 'PATCH', route: '/api/guests/:id', call: (c, a) => c.patch(`/api/guests/${a.guestId}`, { profession: 'Hijacked' }) },
  { method: 'GET', route: '/api/guests/:id/document', call: (c, a) => c.get(`/api/guests/${a.guestId}/document`) },
];

describe('tenant isolation (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let idsA: Ids;

  beforeAll(async () => {
    t = await createTestApp({ extra: [DiscoveryModule] });
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: a.accountId, name: 'Owner A', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({
      data: { accountId: a.accountId, ownerId: owner.id, name: 'Property A', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' },
    });
    const invitation = await t.prisma.invitation.create({
      data: { accountId: a.accountId, email: 'pending@alpha.test', role: 'STAFF', tokenHash: 'h-a', invitedBy: a.users.OWNER_MANAGER.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const feed = await t.prisma.icalFeed.create({ data: { accountId: a.accountId, propertyId: property.id, platform: 'AIRBNB', url: 'https://93.184.216.34/a.ics' } });
    const booking = await t.prisma.booking.create({
      data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date('2026-03-01'), checkOut: new Date('2026-03-04'), source: 'DIRECT' },
    });
    const alert = await t.prisma.notification.create({ data: { accountId: a.accountId, propertyId: property.id, type: 'day_counter.red', severity: 'RED', year: 2026, message: 'm' } });
    const stay = await t.prisma.booking.create({
      data: { accountId: a.accountId, propertyId: property.id, checkIn: new Date(Date.now() + 10 * 86_400_000), checkOut: new Date(Date.now() + 13 * 86_400_000), source: 'DIRECT' },
    });
    const link = await t.prisma.checkInLink.create({
      data: { accountId: a.accountId, bookingId: stay.id, tokenHash: 'iso-link-a', expiresAt: new Date(Date.now() + 30 * 86_400_000), createdBy: a.users.OWNER_MANAGER.id, maxGuests: 2 },
    });
    const image = await t.app.get(StorageService).put(a.accountId, 'ID_IMAGE', Buffer.from('synthetic image bytes'));
    const guest = await t.prisma.guestCheckIn.create({
      data: { accountId: a.accountId, bookingId: stay.id, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'SUBMITTED', docImageId: image.id, submittedAt: new Date() },
    });
    idsA = { ownerId: owner.id, propertyId: property.id, invitationId: invitation.id, feedId: feed.id, bookingId: booking.id, alertId: alert.id, stayId: stay.id, linkId: link.id, guestId: guest.id };
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('covers every route that takes an id', () => {
    // Public routes (the guest link flow) take no tenant id; they are covered by the public flow and abuse tests.
    const idRoutes = listRoutes(t.app).filter((r) => !r.isPublic && r.path.includes(':')).map((r) => `${r.method} ${r.path}`).sort();
    expect(CASES.map((c) => `${c.method} ${c.route}`).sort()).toEqual(idRoutes);
  });

  for (const c of CASES) {
    it(`${c.method} ${c.route} with another account's id → 404`, async () => {
      const res = await c.call(b.as.OWNER_MANAGER, idsA);
      expect(res.status).toBe(404);
    });
  }

  it('lists show nothing from the other account', async () => {
    for (const url of ['/api/properties', '/api/property-owners', '/api/invitations', '/api/alerts']) {
      expect((await b.as.OWNER_MANAGER.get(url).expect(200)).body).toEqual([]);
    }
    const dash = (await b.as.OWNER_MANAGER.get('/api/dashboard').expect(200)).body;
    expect(dash.properties).toEqual([]);
    expect(dash.alerts).toEqual([]);
  });

  it("refuses to attach another account's owner to a property", async () => {
    const own = await t.prisma.propertyOwner.create({ data: { accountId: b.accountId, name: 'Owner B', residency: 'RESIDENT' } });
    const body = { name: 'Sneaky', address: 'x x', commune: 'Marrakech', licenseStatus: 'UNLICENSED', licenseType: 'RIAD', taxRegime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED' };

    const res = await b.as.OWNER_MANAGER.post('/api/properties', { ...body, ownerId: idsA.ownerId }).expect(400);
    expect(res.body.error.details).toEqual([{ field: 'ownerId', errors: ['Owner not found.'] }]);

    const mine = await b.as.OWNER_MANAGER.post('/api/properties', { ...body, ownerId: own.id }).expect(201);
    await b.as.OWNER_MANAGER.patch(`/api/properties/${mine.body.id}`, { ownerId: idsA.ownerId }).expect(400);
  });

  it("left account A's data unchanged", async () => {
    expect((await t.prisma.propertyOwner.findUniqueOrThrow({ where: { id: idsA.ownerId } })).name).toBe('Owner A');
    expect((await t.prisma.property.findUniqueOrThrow({ where: { id: idsA.propertyId } })).name).toBe('Property A');
    expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: idsA.invitationId } })).revokedAt).toBeNull();
    expect((await t.prisma.icalFeed.findUniqueOrThrow({ where: { id: idsA.feedId } })).url).toBe('https://93.184.216.34/a.ics');
    expect((await t.prisma.booking.findUniqueOrThrow({ where: { id: idsA.bookingId } })).classification).toBe('BOOKING');
    expect(await t.prisma.booking.count({ where: { propertyId: idsA.propertyId } })).toBe(2); // the past booking and the future stay
    expect((await t.prisma.checkInLink.findUniqueOrThrow({ where: { id: idsA.linkId } })).revokedAt).toBeNull();
    expect(await t.prisma.checkInLink.count({ where: { bookingId: idsA.stayId } })).toBe(1); // no link was created or resent for A by B
    expect((await t.prisma.guestCheckIn.findUniqueOrThrow({ where: { id: idsA.guestId } })).profession).toBeNull();
    expect(await t.prisma.auditLog.count({ where: { action: 'guest.document.read' } })).toBe(0); // B never read A's image
    expect(await t.prisma.importBatch.count()).toBe(0);
    expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: idsA.alertId } })).resolvedAt).toBeNull();
  });
});
