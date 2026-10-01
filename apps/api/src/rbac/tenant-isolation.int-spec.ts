/**
 * Account isolation: a user of account B must never see or change account A's data.
 * Every route with an :id is attacked with A's ids from B's Owner/Manager (the most privileged role)
 * and must answer 404. Adding an :id route without a case here fails the completeness test.
 */
import { DiscoveryModule } from '@nestjs/core';
import { listRoutes } from '../test/routes';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { StorageService } from '../storage/storage.service';
import { insertTaxReport, seedTaxRules } from '../test/tax-fixtures';
import { Client, createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

interface Ids {
  shareId: string;
  ownerId: string;
  propertyId: string;
  invitationId: string;
  memberId: string;
  checklistItemId: string;
  feedId: string;
  bookingId: string;
  alertId: string;
  stayId: string;
  linkId: string;
  guestId: string;
  taxReportId: string;
}

const CASES: { method: string; route: string; call: (c: Client, ids: Ids) => Promise<{ status: number }> }[] = [
  { method: 'GET', route: '/api/property-owners/:id', call: (c, a) => c.get(`/api/property-owners/${a.ownerId}`) },
  { method: 'PATCH', route: '/api/property-owners/:id', call: (c, a) => c.patch(`/api/property-owners/${a.ownerId}`, { name: 'Hijacked' }) },
  { method: 'GET', route: '/api/properties/:id', call: (c, a) => c.get(`/api/properties/${a.propertyId}`) },
  { method: 'PATCH', route: '/api/properties/:id', call: (c, a) => c.patch(`/api/properties/${a.propertyId}`, { name: 'Hijacked' }) },
  { method: 'DELETE', route: '/api/invitations/:id', call: (c, a) => c.delete(`/api/invitations/${a.invitationId}`) },
  { method: 'POST', route: '/api/invitations/:id/resend', call: (c, a) => c.post(`/api/invitations/${a.invitationId}/resend`) },
  { method: 'GET', route: '/api/properties/:id/checklist', call: (c, a) => c.get(`/api/properties/${a.propertyId}/checklist`) },
  { method: 'PATCH', route: '/api/properties/:id/checklist/:itemId', call: (c, a) => c.patch(`/api/properties/${a.propertyId}/checklist/${a.checklistItemId}`, { status: 'DONE' }) },
  { method: 'POST', route: '/api/properties/:id/checklist/:itemId/document', call: (c, a) => c.upload(`/api/properties/${a.propertyId}/checklist/${a.checklistItemId}/document`, '%PDF-1.4\nx\n%%EOF', {}, 'document.pdf') },
  { method: 'GET', route: '/api/properties/:id/checklist/:itemId/document', call: (c, a) => c.get(`/api/properties/${a.propertyId}/checklist/${a.checklistItemId}/document`) },
  { method: 'DELETE', route: '/api/properties/:id/checklist/:itemId/document', call: (c, a) => c.delete(`/api/properties/${a.propertyId}/checklist/${a.checklistItemId}/document`) },
  { method: 'PATCH', route: '/api/users/:id', call: (c, a) => c.patch(`/api/users/${a.memberId}`, { disabled: true }) },
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
  { method: 'GET', route: '/api/checkin-links/:id/deliveries', call: (c, a) => c.get(`/api/checkin-links/${a.linkId}/deliveries`) },
  { method: 'POST', route: '/api/checkin-links/:id/resend', call: (c, a) => c.post(`/api/checkin-links/${a.linkId}/resend`) },
  { method: 'GET', route: '/api/properties/:id/arrivals', call: (c, a) => c.get(`/api/properties/${a.propertyId}/arrivals`) },
  { method: 'GET', route: '/api/guests/:id', call: (c, a) => c.get(`/api/guests/${a.guestId}`) },
  { method: 'PATCH', route: '/api/guests/:id', call: (c, a) => c.patch(`/api/guests/${a.guestId}`, { profession: 'Hijacked' }) },
  { method: 'GET', route: '/api/guests/:id/fiche', call: (c, a) => c.get(`/api/guests/${a.guestId}/fiche`) },
  { method: 'POST', route: '/api/guests/:id/fiche/regenerate', call: (c, a) => c.post(`/api/guests/${a.guestId}/fiche/regenerate`) },
  { method: 'GET', route: '/api/guests/:id/document', call: (c, a) => c.get(`/api/guests/${a.guestId}/document`) },
  { method: 'GET', route: '/api/properties/:id/registers', call: (c, a) => c.get(`/api/properties/${a.propertyId}/registers`) },
  { method: 'GET', route: '/api/properties/:id/registers/:month/validation', call: (c, a) => c.get(`/api/properties/${a.propertyId}/registers/2026-03/validation`) },
  { method: 'POST', route: '/api/properties/:id/registers/:month', call: (c, a) => c.post(`/api/properties/${a.propertyId}/registers/2026-03`) },
  { method: 'GET', route: '/api/properties/:id/registers/:month/pdf', call: (c, a) => c.get(`/api/properties/${a.propertyId}/registers/2026-03/pdf`) },
  { method: 'DELETE', route: '/api/shares/:id', call: (c, a) => c.delete(`/api/shares/${a.shareId}`) },
  { method: 'POST', route: '/api/shares/:id/renew', call: (c, a) => c.post(`/api/shares/${a.shareId}/renew`, { expiresInHours: 24 }) },
  { method: 'GET', route: '/api/shares/:id/access', call: (c, a) => c.get(`/api/shares/${a.shareId}/access`) },
  { method: 'GET', route: '/api/tax/reports/:id', call: (c, a) => c.get(`/api/tax/reports/${a.taxReportId}`) },
  { method: 'GET', route: '/api/tax/reports/:id/pdf', call: (c, a) => c.get(`/api/tax/reports/${a.taxReportId}/pdf`) },
  { method: 'GET', route: '/api/tax/reports/:id/xlsx', call: (c, a) => c.get(`/api/tax/reports/${a.taxReportId}/xlsx`) },
  { method: 'GET', route: '/api/properties/:id/tax-reports', call: (c, a) => c.get(`/api/properties/${a.propertyId}/tax-reports`) },
  { method: 'GET', route: '/api/properties/:id/tax-reports/:month/missing', call: (c, a) => c.get(`/api/properties/${a.propertyId}/tax-reports/2026-03/missing`) },
  { method: 'POST', route: '/api/properties/:id/tax-reports/:month', call: (c, a) => c.post(`/api/properties/${a.propertyId}/tax-reports/2026-03`) },
  { method: 'PATCH', route: '/api/bookings/:id/amounts', call: (c, a) => c.patch(`/api/bookings/${a.bookingId}/amounts`, { nightlyRevenue: '1.00' }) },
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
    jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 stub'));
    const pdf = await t.app.get(StorageService).put(a.accountId, 'FICHE_PDF', Buffer.from('%PDF-1.4 stub'));
    await t.prisma.ficheDePolice.create({ data: { accountId: a.accountId, guestCheckInId: guest.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
    const step = await t.prisma.checklistTemplateStep.create({ data: { code: 'iso-step', position: 1, nameFr: 'Étape de test', nameEn: 'Test step' } });
    const licenseDoc = await t.app.get(StorageService).put(a.accountId, 'LICENSE_DOCUMENT', Buffer.from('%PDF-1.4 stub'));
    const checklistItem = await t.prisma.checklistItem.create({ data: { accountId: a.accountId, propertyId: property.id, templateStepId: step.id, documentObjectId: licenseDoc.id } });
    const registerPdf = await t.app.get(StorageService).put(a.accountId, 'POLICE_REGISTER_PDF', Buffer.from('%PDF-1.4 stub'));
    await t.prisma.policeRegister.create({ data: { accountId: a.accountId, propertyId: property.id, month: '2026-03', pdfObjectId: registerPdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64), inputDigest: 'd', guestCount: 0, validation: {}, generatedBy: a.users.OWNER_MANAGER.id } });
    const share = await t.prisma.shareLink.create({ data: { accountId: a.accountId, resourceType: 'POLICE_REGISTER', resourceId: 'r', tokenHash: 'iso-share-a', recipientLabel: 'Police', expiresAt: new Date(Date.now() + 86_400_000), createdBy: a.users.OWNER_MANAGER.id } });
    await seedTaxRules(t.prisma);
    const taxReport = await insertTaxReport(t.prisma, t.app.get(StorageService), { accountId: a.accountId, propertyId: property.id, userId: a.users.OWNER_MANAGER.id, month: '2026-02' });
    idsA = {
      taxReportId: taxReport.id,
      shareId: share.id, ownerId: owner.id, propertyId: property.id, invitationId: invitation.id, memberId: a.users.STAFF.id, checklistItemId: checklistItem.id, feedId: feed.id, bookingId: booking.id, alertId: alert.id, stayId: stay.id, linkId: link.id, guestId: guest.id };
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
    for (const url of ['/api/properties', '/api/property-owners', '/api/invitations', '/api/alerts', '/api/shares']) {
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
    expect(await t.prisma.auditLog.count({ where: { action: 'guest.fiche.read' } })).toBe(0); // nor A's Fiche
    expect(await t.prisma.ficheDePolice.count()).toBe(1); // and B's regenerate did not touch it
    expect(await t.prisma.auditLog.count({ where: { action: { in: ['register.read', 'register.generated'] } } })).toBe(0); // nor A's register
    expect(await t.prisma.auditLog.count({ where: { action: 'license_document.read' } })).toBe(0); // B never read A's licence document
    const item = await t.prisma.checklistItem.findUniqueOrThrow({ where: { id: idsA.checklistItemId } });
    expect(item).toMatchObject({ status: 'TODO', documentObjectId: expect.any(String) }); // nor changed or removed it
    expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id: item.documentObjectId! } })).deletedAt).toBeNull();
    expect(await t.prisma.importBatch.count()).toBe(0);
    expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: idsA.alertId } })).resolvedAt).toBeNull();
  });
});
