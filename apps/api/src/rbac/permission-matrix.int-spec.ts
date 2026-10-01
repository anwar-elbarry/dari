/**
 * Permission matrix (Tech Spec §7): every non-public route × every role, with the expected status.
 * Adding a route without a row here fails the completeness test below.
 * Roles run from least to most privileged, so denied calls happen before a successful call changes state.
 */
import { DiscoveryModule } from '@nestjs/core';
import { listRoutes } from '../test/routes';
import { PdfRenderer } from '../checkin/pdf-renderer';
import { StorageService } from '../storage/storage.service';
import { seedTaxRules } from '../test/tax-fixtures';
import { createTestApp, requireDatabase, resetDatabase, RoleName, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

type Who = RoleName | 'ANON';
const ORDER: Who[] = ['ANON', 'ACCOUNTANT', 'STAFF', 'OWNER_MANAGER'];

export interface Fixtures {
  acc: SeededAccount;
  propertyId: string;
  ownerId: string;
  feedId: string;
  bookingId: string;
  alertId: () => Promise<string>;
  invitationId: () => Promise<string>;
  /** A throwaway active Staff member, so mutating it never disturbs the seeded Staff session used by later rows. */
  memberId: () => Promise<string>;
  freshFeedId: () => Promise<string>;
  /** A confirmed booking that starts in ten days (check-in links are only issued for current and future stays). */
  stayId: string;
  linkId: () => Promise<string>;
  /** A submitted guest with an encrypted ID image. */
  guestId: string;
  shareId: () => Promise<string>;
  /** A share that points at the guest's real Fiche, so renewing it can succeed. */
  renewableShareId: () => Promise<string>;
  /** A checklist item on the property; `withDocument` also gives it an encrypted document. Synthetic test step, not a real checklist. */
  checklistItemId: (withDocument?: boolean) => Promise<string>;
  taxReportId: string;
}

interface Row {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Send `csv` as an uploaded file instead of a JSON body. */
  csv?: string;
  /** Same, for a document upload. */
  file?: string;
  /** Route pattern as registered, e.g. /api/properties/:id */
  route: string;
  url: (f: Fixtures) => string | Promise<string>;
  body?: (f: Fixtures) => object;
  expect: Record<Who, number>;
}

const ALL_SIGNED_IN = { ANON: 401, ACCOUNTANT: 200, STAFF: 200, OWNER_MANAGER: 200 };
const MANAGER_ONLY = (ok: number) => ({ ANON: 401, ACCOUNTANT: 403, STAFF: 403, OWNER_MANAGER: ok });
/** Tax reports: Owner/Manager and Accountant; Staff never. */
const REPORT_READ = { ANON: 401, ACCOUNTANT: 200, STAFF: 403, OWNER_MANAGER: 200 };
const STAFF_READ = { ANON: 401, ACCOUNTANT: 403, STAFF: 200, OWNER_MANAGER: 200 };

export const MATRIX: Row[] = [
  { method: 'GET', route: '/api/me', url: () => '/api/me', expect: ALL_SIGNED_IN },

  // Invitations (team:manage)
  { method: 'POST', route: '/api/invitations', url: () => '/api/invitations', body: () => ({ email: 'new@matrix.test', role: 'STAFF' }), expect: MANAGER_ONLY(201) },
  { method: 'GET', route: '/api/invitations', url: () => '/api/invitations', expect: MANAGER_ONLY(200) },
  { method: 'DELETE', route: '/api/invitations/:id', url: async (f) => `/api/invitations/${await f.invitationId()}`, expect: MANAGER_ONLY(204) },
  { method: 'POST', route: '/api/invitations/:id/resend', url: async (f) => `/api/invitations/${await f.invitationId()}/resend`, expect: MANAGER_ONLY(204) },

  // Licensing checklist (checklist:read for Staff, status only; checklist:write and license_document:read for Owner/Manager)
  { method: 'GET', route: '/api/properties/:id/checklist', url: (f) => `/api/properties/${f.propertyId}/checklist`, expect: STAFF_READ },
  { method: 'PATCH', route: '/api/properties/:id/checklist/:itemId', url: async (f) => `/api/properties/${f.propertyId}/checklist/${await f.checklistItemId()}`, body: () => ({ status: 'IN_PROGRESS' }), expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/properties/:id/checklist/:itemId/document', url: async (f) => `/api/properties/${f.propertyId}/checklist/${await f.checklistItemId()}/document`, file: '%PDF-1.4\nsynthetic licence document\n%%EOF', expect: MANAGER_ONLY(200) },
  { method: 'GET', route: '/api/properties/:id/checklist/:itemId/document', url: async (f) => `/api/properties/${f.propertyId}/checklist/${await f.checklistItemId(true)}/document`, expect: MANAGER_ONLY(200) },
  { method: 'DELETE', route: '/api/properties/:id/checklist/:itemId/document', url: async (f) => `/api/properties/${f.propertyId}/checklist/${await f.checklistItemId(true)}/document`, expect: MANAGER_ONLY(204) },

  // A user's own alert channels and WhatsApp number: any signed-in role, only ever the caller's own rows
  { method: 'GET', route: '/api/me/notification-preferences', url: () => '/api/me/notification-preferences', expect: ALL_SIGNED_IN },
  { method: 'PUT', route: '/api/me/notification-preferences', url: () => '/api/me/notification-preferences', body: () => ({ alertType: 'day_counter.red', channel: 'EMAIL' }), expect: ALL_SIGNED_IN },
  { method: 'PUT', route: '/api/me/phone', url: () => '/api/me/phone', body: () => ({ phone: '+212612345678' }), expect: ALL_SIGNED_IN },

  // Team management (team:manage)
  { method: 'GET', route: '/api/users', url: () => '/api/users', expect: MANAGER_ONLY(200) },
  { method: 'PATCH', route: '/api/users/:id', url: async (f) => `/api/users/${await f.memberId()}`, body: () => ({ disabled: true }), expect: MANAGER_ONLY(200) },

  // Owners (owner:read / owner:write)
  { method: 'GET', route: '/api/property-owners', url: () => '/api/property-owners', expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/property-owners', url: () => '/api/property-owners', body: () => ({ name: 'New Owner', residency: 'RESIDENT' }), expect: MANAGER_ONLY(201) },
  { method: 'GET', route: '/api/property-owners/:id', url: (f) => `/api/property-owners/${f.ownerId}`, expect: MANAGER_ONLY(200) },
  { method: 'PATCH', route: '/api/property-owners/:id', url: (f) => `/api/property-owners/${f.ownerId}`, body: () => ({ taxId: 'X1' }), expect: MANAGER_ONLY(200) },

  // Properties (Staff read a reduced view; Accountant has no access)
  { method: 'GET', route: '/api/properties', url: () => '/api/properties', expect: STAFF_READ },
  {
    method: 'POST',
    route: '/api/properties',
    url: () => '/api/properties',
    body: (f) => ({ name: 'New', address: 'Somewhere', commune: 'Marrakech', licenseStatus: 'UNLICENSED', licenseType: 'RIAD', taxRegime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED', ownerId: f.ownerId }),
    expect: MANAGER_ONLY(201),
  },
  { method: 'GET', route: '/api/properties/:id', url: (f) => `/api/properties/${f.propertyId}`, expect: STAFF_READ },
  { method: 'PATCH', route: '/api/properties/:id', url: (f) => `/api/properties/${f.propertyId}`, body: () => ({ licenseStatus: 'PENDING' }), expect: MANAGER_ONLY(200) },

  // Calendar feeds (ical:manage)
  { method: 'GET', route: '/api/properties/:id/feeds', url: (f) => `/api/properties/${f.propertyId}/feeds`, expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/properties/:id/feeds', url: (f) => `/api/properties/${f.propertyId}/feeds`, body: () => ({ platform: 'DIRECT', url: 'https://93.184.216.34/cal.ics' }), expect: MANAGER_ONLY(201) },
  { method: 'PATCH', route: '/api/properties/:id/feeds/:feedId', url: (f) => `/api/properties/${f.propertyId}/feeds/${f.feedId}`, body: () => ({ url: 'https://93.184.216.34/z.ics' }), expect: MANAGER_ONLY(200) },
  { method: 'DELETE', route: '/api/properties/:id/feeds/:feedId', url: async (f) => `/api/properties/${f.propertyId}/feeds/${await f.freshFeedId()}`, expect: MANAGER_ONLY(204) },
  { method: 'POST', route: '/api/properties/:id/feeds/:feedId/sync', url: (f) => `/api/properties/${f.propertyId}/feeds/${f.feedId}/sync`, expect: MANAGER_ONLY(200) },

  // Day counter and stays (booking:read for Staff; classification needs booking:write)
  { method: 'GET', route: '/api/properties/:id/day-counter', url: (f) => `/api/properties/${f.propertyId}/day-counter`, expect: STAFF_READ },
  { method: 'GET', route: '/api/properties/:id/bookings', url: (f) => `/api/properties/${f.propertyId}/bookings`, expect: STAFF_READ },
  { method: 'PATCH', route: '/api/bookings/:id/classification', url: (f) => `/api/bookings/${f.bookingId}/classification`, body: () => ({ classification: 'OWNER_BLOCK' }), expect: MANAGER_ONLY(200) },

  // Dashboard and alerts (booking:read; closing needs alert:resolve)
  { method: 'GET', route: '/api/dashboard', url: () => '/api/dashboard', expect: STAFF_READ },
  { method: 'GET', route: '/api/alerts', url: () => '/api/alerts', expect: STAFF_READ },
  { method: 'PATCH', route: '/api/alerts/:id', url: async (f) => `/api/alerts/${await f.alertId()}`, expect: MANAGER_ONLY(200) },

  // CSV import (booking:write)
  { method: 'GET', route: '/api/imports/template.csv', url: () => '/api/imports/template.csv', expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/properties/:id/imports/preview', url: (f) => `/api/properties/${f.propertyId}/imports/preview`, csv: 'check_in,check_out\n2026-01-01,2026-01-03\n', expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/properties/:id/imports', url: (f) => `/api/properties/${f.propertyId}/imports`, csv: 'check_in,check_out\n2026-01-01,2026-01-03\n', expect: MANAGER_ONLY(201) },

  // Guest check-in (Phase 3). Staff send links and see status; only Owner/Manager see fields, images, corrections.
  // The public guest routes (/api/checkin...) are @Public and have their own abuse suite.
  { method: 'POST', route: '/api/bookings/:id/checkin-links', url: (f) => `/api/bookings/${f.stayId}/checkin-links`, body: () => ({}), expect: { ANON: 401, ACCOUNTANT: 403, STAFF: 201, OWNER_MANAGER: 201 } },
  { method: 'GET', route: '/api/bookings/:id/checkin-links', url: (f) => `/api/bookings/${f.stayId}/checkin-links`, expect: STAFF_READ },
  { method: 'DELETE', route: '/api/checkin-links/:id', url: async (f) => `/api/checkin-links/${await f.linkId()}`, expect: { ANON: 401, ACCOUNTANT: 403, STAFF: 204, OWNER_MANAGER: 204 } },
  { method: 'GET', route: '/api/checkin-links/:id/deliveries', url: async (f) => `/api/checkin-links/${await f.linkId()}/deliveries`, expect: { ANON: 401, ACCOUNTANT: 403, STAFF: 200, OWNER_MANAGER: 200 } },
  { method: 'POST', route: '/api/checkin-links/:id/resend', url: async (f) => `/api/checkin-links/${await f.linkId()}/resend`, body: () => ({}), expect: { ANON: 401, ACCOUNTANT: 403, STAFF: 201, OWNER_MANAGER: 201 } },
  { method: 'GET', route: '/api/properties/:id/arrivals', url: (f) => `/api/properties/${f.propertyId}/arrivals`, expect: STAFF_READ },
  { method: 'GET', route: '/api/guests/:id', url: (f) => `/api/guests/${f.guestId}`, expect: STAFF_READ },
  { method: 'PATCH', route: '/api/guests/:id', url: (f) => `/api/guests/${f.guestId}`, body: () => ({ profession: 'Engineer' }), expect: MANAGER_ONLY(200) },
  { method: 'GET', route: '/api/guests/:id/fiche', url: (f) => `/api/guests/${f.guestId}/fiche`, expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/guests/:id/fiche/regenerate', url: (f) => `/api/guests/${f.guestId}/fiche/regenerate`, body: () => ({}), expect: MANAGER_ONLY(200) },
  { method: 'GET', route: '/api/guests/:id/document', url: (f) => `/api/guests/${f.guestId}/document`, expect: MANAGER_ONLY(200) },

  // Monthly police register (Phase 4). Staff see which months exist; only Owner/Manager see validation, generate or open the PDF.
  { method: 'GET', route: '/api/properties/:id/registers', url: (f) => `/api/properties/${f.propertyId}/registers`, expect: STAFF_READ },
  { method: 'GET', route: '/api/properties/:id/registers/:month/validation', url: (f) => `/api/properties/${f.propertyId}/registers/2026-03/validation`, expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/properties/:id/registers/:month', url: (f) => `/api/properties/${f.propertyId}/registers/2026-03`, body: () => ({}), expect: MANAGER_ONLY(200) },
  { method: 'GET', route: '/api/properties/:id/registers/:month/pdf', url: (f) => `/api/properties/${f.propertyId}/registers/2026-03/pdf`, expect: MANAGER_ONLY(200) },

  // Secure Share (Phase 4): Owner/Manager only. The public route /api/share is @Public and has its own abuse suite.
  { method: 'POST', route: '/api/shares', url: () => '/api/shares', body: (f) => ({ resourceType: 'FICHE_DE_POLICE', guestId: f.guestId, expiresInHours: 24, recipientLabel: 'Préfecture' }), expect: MANAGER_ONLY(201) },
  { method: 'GET', route: '/api/shares', url: () => '/api/shares', expect: MANAGER_ONLY(200) },
  { method: 'GET', route: '/api/shares/lifetime', url: () => '/api/shares/lifetime', expect: MANAGER_ONLY(200) },
  { method: 'DELETE', route: '/api/shares/:id', url: async (f) => `/api/shares/${await f.shareId()}`, expect: MANAGER_ONLY(204) },
  { method: 'POST', route: '/api/shares/:id/renew', url: async (f) => `/api/shares/${await f.renewableShareId()}/renew`, body: () => ({ expiresInHours: 24 }), expect: MANAGER_ONLY(201) },
  { method: 'GET', route: '/api/shares/:id/access', url: async (f) => `/api/shares/${await f.shareId()}/access`, expect: MANAGER_ONLY(200) },

  // Tax estimates (Phase 5). The Accountant reads reports and their exports (report:read); only Owner/Manager generate, see what is missing, or fill in a stay's amounts.
  { method: 'GET', route: '/api/tax/rules', url: () => '/api/tax/rules', expect: REPORT_READ },
  { method: 'GET', route: '/api/tax/reports', url: () => '/api/tax/reports', expect: REPORT_READ },
  { method: 'GET', route: '/api/tax/reports/:id', url: (f) => `/api/tax/reports/${f.taxReportId}`, expect: REPORT_READ },
  { method: 'GET', route: '/api/tax/reports/:id/pdf', url: (f) => `/api/tax/reports/${f.taxReportId}/pdf`, expect: REPORT_READ },
  { method: 'GET', route: '/api/tax/reports/:id/xlsx', url: (f) => `/api/tax/reports/${f.taxReportId}/xlsx`, expect: REPORT_READ },
  { method: 'GET', route: '/api/properties/:id/tax-reports', url: (f) => `/api/properties/${f.propertyId}/tax-reports`, expect: MANAGER_ONLY(200) },
  { method: 'GET', route: '/api/properties/:id/tax-reports/:month/missing', url: (f) => `/api/properties/${f.propertyId}/tax-reports/2026-03/missing`, expect: MANAGER_ONLY(200) },
  { method: 'POST', route: '/api/properties/:id/tax-reports/:month', url: (f) => `/api/properties/${f.propertyId}/tax-reports/2026-03`, body: () => ({}), expect: MANAGER_ONLY(200) },
  { method: 'PATCH', route: '/api/bookings/:id/amounts', url: (f) => `/api/bookings/${f.bookingId}/amounts`, body: () => ({ nightlyRevenue: '1200.50' }), expect: MANAGER_ONLY(200) },
];

describe('permission matrix (integration)', () => {
  let t: TestApp;
  let f: Fixtures;

  beforeAll(async () => {
    t = await createTestApp({ extra: [DiscoveryModule] });
    await resetDatabase(t.prisma, t.redis);
    const acc = await seedAccount(t, 'Matrix');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: acc.accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({
      data: { accountId: acc.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' },
    });
    const feed = await t.prisma.icalFeed.create({ data: { accountId: acc.accountId, propertyId: property.id, platform: 'AIRBNB', url: 'https://93.184.216.34/a.ics' } });
    const booking = await t.prisma.booking.create({
      data: { accountId: acc.accountId, propertyId: property.id, checkIn: new Date('2026-03-01'), checkOut: new Date('2026-03-04'), source: 'DIRECT' },
    });
    const stay = await t.prisma.booking.create({
      data: { accountId: acc.accountId, propertyId: property.id, checkIn: new Date(Date.now() + 10 * 86_400_000), checkOut: new Date(Date.now() + 13 * 86_400_000), source: 'DIRECT' },
    });
    const link = await t.prisma.checkInLink.create({
      data: { accountId: acc.accountId, bookingId: stay.id, tokenHash: 'matrix-seed-link', expiresAt: new Date(Date.now() + 30 * 86_400_000), createdBy: acc.users.OWNER_MANAGER.id, maxGuests: 2 },
    });
    const image = await t.app.get(StorageService).put(acc.accountId, 'ID_IMAGE', Buffer.from('synthetic image bytes'));
    const guest = await t.prisma.guestCheckIn.create({
      data: { accountId: acc.accountId, bookingId: stay.id, propertyId: property.id, linkId: link.id, guestIndex: 1, status: 'SUBMITTED', fullName: 'Test Guest', docImageId: image.id, submittedAt: new Date() },
    });
    // The matrix tests who may call the routes, not the browser: the renderer is stubbed.
    jest.spyOn(t.app.get(PdfRenderer), 'render').mockResolvedValue(Buffer.from('%PDF-1.4 stub'));
    const pdf = await t.app.get(StorageService).put(acc.accountId, 'FICHE_PDF', Buffer.from('%PDF-1.4 stub'));
    await t.prisma.ficheDePolice.create({ data: { accountId: acc.accountId, guestCheckInId: guest.id, pdfObjectId: pdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64) } });
    const registerPdf = await t.app.get(StorageService).put(acc.accountId, 'POLICE_REGISTER_PDF', Buffer.from('%PDF-1.4 stub'));
    await t.prisma.policeRegister.create({ data: { accountId: acc.accountId, propertyId: property.id, month: '2026-03', pdfObjectId: registerPdf.id, templateVersion: 'draft-1', sha256: 'a'.repeat(64), inputDigest: 'd', guestCount: 0, validation: {}, generatedBy: acc.users.OWNER_MANAGER.id } });
    await seedTaxRules(t.prisma);
    // A real, current report (an export of an out-of-date one is refused): February, which no other row touches.
    const taxReportId = ((await acc.as.OWNER_MANAGER.post(`/api/properties/${property.id}/tax-reports/2026-02`).expect(200)).body as { id: string }).id;
    let n = 0;
    f = {
      taxReportId,
      checklistItemId: async (withDocument = false) => {
        const step = await t.prisma.checklistTemplateStep.create({ data: { code: `matrix-step-${n++}`, position: n, nameFr: 'Étape de test', nameEn: 'Test step' } });
        const doc = withDocument ? await t.app.get(StorageService).put(acc.accountId, 'LICENSE_DOCUMENT', Buffer.from('%PDF-1.4 stub')) : null;
        return (await t.prisma.checklistItem.create({ data: { accountId: acc.accountId, propertyId: property.id, templateStepId: step.id, documentObjectId: doc?.id } })).id;
      },
      shareId: async () =>
        (await t.prisma.shareLink.create({ data: { accountId: acc.accountId, resourceType: 'POLICE_REGISTER', resourceId: 'r', tokenHash: `matrix-share-${n++}`, recipientLabel: 'Police', expiresAt: new Date(Date.now() + 86_400_000), createdBy: acc.users.OWNER_MANAGER.id } })).id,
      renewableShareId: async () => {
        const fiche = await t.prisma.ficheDePolice.findFirstOrThrow({ where: { accountId: acc.accountId, guestCheckInId: guest.id } });
        return (await t.prisma.shareLink.create({ data: { accountId: acc.accountId, resourceType: 'FICHE_DE_POLICE', resourceId: fiche.id, tokenHash: `matrix-renew-${n++}`, recipientLabel: 'Police', expiresAt: new Date(Date.now() + 86_400_000), createdBy: acc.users.OWNER_MANAGER.id } })).id;
      },
      stayId: stay.id,
      guestId: guest.id,
      linkId: async () =>
        (await t.prisma.checkInLink.create({ data: { accountId: acc.accountId, bookingId: stay.id, tokenHash: `matrix-link-${n++}`, expiresAt: new Date(Date.now() + 30 * 86_400_000), createdBy: acc.users.OWNER_MANAGER.id, maxGuests: 2 } })).id,
      acc,
      propertyId: property.id,
      ownerId: owner.id,
      feedId: feed.id,
      bookingId: booking.id,
      alertId: async () =>
        (await t.prisma.notification.create({ data: { accountId: acc.accountId, propertyId: property.id, type: 'day_counter.amber', severity: 'AMBER', year: 2000 + n++, message: 'm' } })).id,
      freshFeedId: async () =>
        (
          await t.prisma.icalFeed.upsert({
            where: { propertyId_platform: { propertyId: property.id, platform: 'BOOKING' } },
            update: {},
            create: { accountId: acc.accountId, propertyId: property.id, platform: 'BOOKING', url: 'https://93.184.216.34/b.ics' },
          })
        ).id,
      memberId: async () =>
        (await t.prisma.user.create({ data: { accountId: acc.accountId, name: 'Temp', email: `temp${n++}@matrix.test`, role: 'STAFF', passwordHash: 'x' } })).id,
      invitationId: async () =>
        (
          await t.prisma.invitation.create({
            data: { accountId: acc.accountId, email: `inv${n++}@matrix.test`, role: 'STAFF', tokenHash: `hash-${n}`, invitedBy: acc.users.OWNER_MANAGER.id, expiresAt: new Date(Date.now() + 86_400_000) },
          })
        ).id,
    };
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('covers every non-public route', () => {
    const declared = listRoutes(t.app).filter((r) => !r.isPublic).map((r) => `${r.method} ${r.path}`).sort();
    const covered = MATRIX.map((r) => `${r.method} ${r.route}`).sort();
    expect(covered).toEqual(declared);
  });

  for (const row of MATRIX) {
    it(`${row.method} ${row.route}`, async () => {
      for (const who of ORDER) {
        const c = f.acc.as[who];
        const url = await row.url(f);
        const body = row.body?.(f);
        const req = (row.csv ?? row.file)
          ? c.upload(url, (row.csv ?? row.file)!, {}, row.file ? 'document.pdf' : 'import.csv')
          : row.method === 'GET' ? c.get(url) : row.method === 'POST' ? c.post(url, body) : row.method === 'PUT' ? c.put(url, body) : row.method === 'PATCH' ? c.patch(url, body) : c.delete(url);
        const res = await req;
        expect({ who, status: res.status }).toEqual({ who, status: row.expect[who] });
      }
    });
  }
});
