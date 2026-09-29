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
  invitationId: () => Promise<string>;
}

interface Row {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Route pattern as registered, e.g. /api/properties/:id */
  route: string;
  url: (f: Fixtures) => string | Promise<string>;
  body?: (f: Fixtures) => object;
  expect: Record<Who, number>;
}

const ALL_SIGNED_IN = { ANON: 401, ACCOUNTANT: 200, STAFF: 200, OWNER_MANAGER: 200 };
const MANAGER_ONLY = (ok: number) => ({ ANON: 401, ACCOUNTANT: 403, STAFF: 403, OWNER_MANAGER: ok });

export const MATRIX: Row[] = [
  { method: 'GET', route: '/api/me', url: () => '/api/me', expect: ALL_SIGNED_IN },

  // Invitations (team:manage)
  { method: 'POST', route: '/api/invitations', url: () => '/api/invitations', body: () => ({ email: 'new@matrix.test', role: 'STAFF' }), expect: MANAGER_ONLY(201) },
  { method: 'GET', route: '/api/invitations', url: () => '/api/invitations', expect: MANAGER_ONLY(200) },
  { method: 'DELETE', route: '/api/invitations/:id', url: async (f) => `/api/invitations/${await f.invitationId()}`, expect: MANAGER_ONLY(204) },
];

describe('permission matrix (integration)', () => {
  let t: TestApp;
  let f: Fixtures;

  beforeAll(async () => {
    t = await createTestApp({ extra: [DiscoveryModule] });
    await resetDatabase(t.prisma);
    const acc = await seedAccount(t, 'Matrix');
    const owner = await t.prisma.propertyOwner.create({ data: { accountId: acc.accountId, name: 'Owner', residency: 'RESIDENT' } });
    const property = await t.prisma.property.create({
      data: { accountId: acc.accountId, ownerId: owner.id, name: 'Riad', address: 'x', commune: 'Marrakech', licenseType: 'RIAD' },
    });
    let n = 0;
    f = {
      acc,
      propertyId: property.id,
      ownerId: owner.id,
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
        const req =
          row.method === 'GET' ? c.get(url) : row.method === 'POST' ? c.post(url, body) : row.method === 'PATCH' ? c.patch(url, body) : c.delete(url);
        const res = await req;
        expect({ who, status: res.status }).toEqual({ who, status: row.expect[who] });
      }
    });
  }
});
