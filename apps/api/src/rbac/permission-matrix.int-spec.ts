/**
 * Permission matrix (Tech Spec §7): every non-public route × every role, with the expected status.
 * Adding a route without a row here fails the completeness test below.
 * Roles run from least to most privileged, so denied calls happen before a successful call changes state.
 */
import { DiscoveryModule } from '@nestjs/core';
import { listRoutes } from '../test/routes';
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
  freshFeedId: () => Promise<string>;
}

interface Row {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Send `csv` as an uploaded file instead of a JSON body. */
  csv?: string;
  /** Route pattern as registered, e.g. /api/properties/:id */
  route: string;
  url: (f: Fixtures) => string | Promise<string>;
  body?: (f: Fixtures) => object;
  expect: Record<Who, number>;
}

const ALL_SIGNED_IN = { ANON: 401, ACCOUNTANT: 200, STAFF: 200, OWNER_MANAGER: 200 };
const MANAGER_ONLY = (ok: number) => ({ ANON: 401, ACCOUNTANT: 403, STAFF: 403, OWNER_MANAGER: ok });
const STAFF_READ = { ANON: 401, ACCOUNTANT: 403, STAFF: 200, OWNER_MANAGER: 200 };

export const MATRIX: Row[] = [
  { method: 'GET', route: '/api/me', url: () => '/api/me', expect: ALL_SIGNED_IN },

  // Invitations (team:manage)
  { method: 'POST', route: '/api/invitations', url: () => '/api/invitations', body: () => ({ email: 'new@matrix.test', role: 'STAFF' }), expect: MANAGER_ONLY(201) },
  { method: 'GET', route: '/api/invitations', url: () => '/api/invitations', expect: MANAGER_ONLY(200) },
  { method: 'DELETE', route: '/api/invitations/:id', url: async (f) => `/api/invitations/${await f.invitationId()}`, expect: MANAGER_ONLY(204) },

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
    let n = 0;
    f = {
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
        const req = row.csv
          ? c.upload(url, row.csv)
          : row.method === 'GET' ? c.get(url) : row.method === 'POST' ? c.post(url, body) : row.method === 'PATCH' ? c.patch(url, body) : c.delete(url);
        const res = await req;
        expect({ who, status: res.status }).toEqual({ who, status: row.expect[who] });
      }
    });
  }
});
