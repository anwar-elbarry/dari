/**
 * Account isolation: a user of account B must never see or change account A's data.
 * Every route with an :id is attacked with A's ids from B's Owner/Manager (the most privileged role)
 * and must answer 404. Adding an :id route without a case here fails the completeness test.
 */
import { DiscoveryModule } from '@nestjs/core';
import { listRoutes } from '../test/routes';
import { Client, createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

interface Ids {
  ownerId: string;
  propertyId: string;
  invitationId: string;
}

const CASES: { method: string; route: string; call: (c: Client, ids: Ids) => Promise<{ status: number }> }[] = [
  { method: 'GET', route: '/api/property-owners/:id', call: (c, a) => c.get(`/api/property-owners/${a.ownerId}`) },
  { method: 'PATCH', route: '/api/property-owners/:id', call: (c, a) => c.patch(`/api/property-owners/${a.ownerId}`, { name: 'Hijacked' }) },
  { method: 'GET', route: '/api/properties/:id', call: (c, a) => c.get(`/api/properties/${a.propertyId}`) },
  { method: 'PATCH', route: '/api/properties/:id', call: (c, a) => c.patch(`/api/properties/${a.propertyId}`, { name: 'Hijacked' }) },
  { method: 'DELETE', route: '/api/invitations/:id', call: (c, a) => c.delete(`/api/invitations/${a.invitationId}`) },
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
    idsA = { ownerId: owner.id, propertyId: property.id, invitationId: invitation.id };
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('covers every route that takes an id', () => {
    const idRoutes = listRoutes(t.app).filter((r) => r.path.includes(':')).map((r) => `${r.method} ${r.path}`).sort();
    expect(CASES.map((c) => `${c.method} ${c.route}`).sort()).toEqual(idRoutes);
  });

  for (const c of CASES) {
    it(`${c.method} ${c.route} with another account's id → 404`, async () => {
      const res = await c.call(b.as.OWNER_MANAGER, idsA);
      expect(res.status).toBe(404);
    });
  }

  it('lists show nothing from the other account', async () => {
    for (const url of ['/api/properties', '/api/property-owners', '/api/invitations']) {
      expect((await b.as.OWNER_MANAGER.get(url).expect(200)).body).toEqual([]);
    }
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
  });
});
