import { createTestApp, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

const PROPERTY = {
  name: 'Riad Yasmine',
  address: '12 Derb Sidi Bouloukat, Médina',
  commune: 'Marrakech',
  licenseStatus: 'UNLICENSED',
  licenseType: 'RIAD',
  taxRegime: 'PROPERTY_INCOME',
  taxeSejourMode: 'COLLECTED',
};

describe('owners and properties (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = await seedAccount(t, 'Alpha');
  });

  async function createOwner(body: object = { name: 'Karim Benali', residency: 'MRE', bankAccountType: 'CONVERTIBLE_DIRHAM' }) {
    return (await a.as.OWNER_MANAGER.post('/api/property-owners', body).expect(201)).body;
  }

  it('creates, lists, reads and updates an owner', async () => {
    const owner = await createOwner();
    expect(owner).toEqual({ id: expect.any(String), name: 'Karim Benali', taxId: null, residency: 'MRE', bankAccountType: 'CONVERTIBLE_DIRHAM' });

    const list = await a.as.OWNER_MANAGER.get('/api/property-owners').expect(200);
    expect(list.body).toEqual([{ ...owner, _count: { properties: 0 } }]);

    const updated = await a.as.OWNER_MANAGER.patch(`/api/property-owners/${owner.id}`, { taxId: 'AB123456', residency: 'NON_RESIDENT' }).expect(200);
    expect(updated.body).toMatchObject({ taxId: 'AB123456', residency: 'NON_RESIDENT', properties: [] });

    const actions = (await t.prisma.auditLog.findMany({ where: { resourceType: 'PropertyOwner' } })).map((x) => x.action).sort();
    expect(actions).toEqual(['property_owner.created', 'property_owner.updated']);
  });

  it('creates a property with explicit license, tax regime and Taxe de Séjour mode', async () => {
    const owner = await createOwner();
    const res = await a.as.OWNER_MANAGER.post('/api/properties', { ...PROPERTY, ownerId: owner.id }).expect(201);
    expect(res.body).toMatchObject({ ...PROPERTY, owner: { id: owner.id, name: 'Karim Benali', residency: 'MRE' }, icalUrl: null });
    expect(await t.prisma.auditLog.count({ where: { action: 'property.created' } })).toBe(1);
  });

  it('requires the licensing and tax choices and rejects unknown fields', async () => {
    const owner = await createOwner();
    const noChoices = { name: 'X Riad', address: 'Somewhere', commune: 'Marrakech', ownerId: owner.id };
    const res = await a.as.OWNER_MANAGER.post('/api/properties', noChoices).expect(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['licenseStatus', 'licenseType', 'taxRegime', 'taxeSejourMode']);

    await a.as.OWNER_MANAGER.post('/api/properties', { ...PROPERTY, ownerId: owner.id, accountId: a.accountId }).expect(400);
    await a.as.OWNER_MANAGER.post('/api/properties', { ...PROPERTY, ownerId: owner.id, licenseType: 'HOTEL' }).expect(400);
  });

  it('updates a property and can move it to another owner of the same account', async () => {
    const o1 = await createOwner();
    const o2 = await createOwner({ name: 'Leila Amrani', residency: 'RESIDENT' });
    const p = (await a.as.OWNER_MANAGER.post('/api/properties', { ...PROPERTY, ownerId: o1.id }).expect(201)).body;

    const res = await a.as.OWNER_MANAGER.patch(`/api/properties/${p.id}`, { licenseStatus: 'PENDING', ownerId: o2.id }).expect(200);
    expect(res.body).toMatchObject({ licenseStatus: 'PENDING', owner: { id: o2.id } });

    const owner2 = await a.as.OWNER_MANAGER.get(`/api/property-owners/${o2.id}`).expect(200);
    expect(owner2.body.properties).toEqual([{ id: p.id, name: 'Riad Yasmine' }]);
  });

  it('shows Staff only the reduced view', async () => {
    const owner = await createOwner();
    const p = (await a.as.OWNER_MANAGER.post('/api/properties', { ...PROPERTY, ownerId: owner.id }).expect(201)).body;
    const reduced = ['address', 'commune', 'id', 'licenseStatus', 'licenseType', 'name'];

    const list = await a.as.STAFF.get('/api/properties').expect(200);
    expect(Object.keys(list.body[0]).sort()).toEqual(reduced);
    const one = await a.as.STAFF.get(`/api/properties/${p.id}`).expect(200);
    expect(Object.keys(one.body).sort()).toEqual(reduced);
    expect(JSON.stringify(one.body)).not.toContain('Karim');
  });

  it('returns 400 for a malformed id and 404 for an unknown one', async () => {
    await a.as.OWNER_MANAGER.get('/api/properties/not-a-uuid').expect(400);
    await a.as.OWNER_MANAGER.get('/api/properties/00000000-0000-4000-8000-000000000000').expect(404);
  });
});
