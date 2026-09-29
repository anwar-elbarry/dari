import { AccountScopeError } from './account-scope';
import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';

requireDatabase();

describe('forAccount (integration)', () => {
  let t: TestApp;
  let a: string;
  let b: string;
  let propertyB: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = (await t.prisma.account.create({ data: { companyName: 'A' } })).id;
    b = (await t.prisma.account.create({ data: { companyName: 'B' } })).id;
    for (const [accountId, name] of [[a, 'Prop A'], [b, 'Prop B']]) {
      const owner = await t.prisma.propertyOwner.create({ data: { accountId, name: `Owner ${name}`, residency: 'RESIDENT' } });
      const p = await t.prisma.property.create({
        data: { accountId, ownerId: owner.id, name, address: 'x', commune: 'Marrakech', licenseType: 'RIAD' },
      });
      if (accountId === b) propertyB = p.id;
    }
  });

  it('only lists and counts rows of its account', async () => {
    const scoped = t.prisma.forAccount(a);
    expect((await scoped.property.findMany()).map((p) => p.name)).toEqual(['Prop A']);
    expect(await scoped.property.count()).toBe(1);
  });

  it('cannot read, update or delete another account row by id', async () => {
    const scoped = t.prisma.forAccount(a);
    expect(await scoped.property.findUnique({ where: { id: propertyB } })).toBeNull();
    expect(await scoped.property.findFirst({ where: { id: propertyB } })).toBeNull();
    await expect(scoped.property.update({ where: { id: propertyB }, data: { name: 'hacked' } })).rejects.toThrow();
    expect((await scoped.property.updateMany({ where: { id: propertyB }, data: { name: 'hacked' } })).count).toBe(0);
    await expect(scoped.property.delete({ where: { id: propertyB } })).rejects.toThrow();
    expect((await t.prisma.property.findUniqueOrThrow({ where: { id: propertyB } })).name).toBe('Prop B');
  });

  it('creates rows in its own account', async () => {
    const owner = await t.prisma.forAccount(a).propertyOwner.create({ data: { name: 'New owner', residency: 'MRE' } as never });
    expect(owner.accountId).toBe(a);
  });

  it('refuses writes aimed at another account and models without a rule', async () => {
    const scoped = t.prisma.forAccount(a);
    await expect(scoped.propertyOwner.create({ data: { accountId: b, name: 'x', residency: 'RESIDENT' } })).rejects.toThrow(AccountScopeError);
    await expect(scoped.booking.findMany()).rejects.toThrow(/no account scope rule/);
  });

  it('keeps the scope inside interactive transactions', async () => {
    const names = await t.prisma.forAccount(a).$transaction((tx) => tx.property.findMany());
    expect(names.map((p) => p.name)).toEqual(['Prop A']);
  });
});
