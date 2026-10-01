import { client, createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { createAccount } from './account-create';

requireDatabase();

describe('account:create (integration)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { SIGNUP_ENABLED: 'false' } });
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const input = { companyName: 'Riad Pilot', ownerName: 'Pilot Owner', email: 'pilot@x.test', seatLimit: 3 };

  it('creates the account and its owner while signup is closed; the owner sets a password through the reset flow', async () => {
    const r = await createAccount(t.prisma, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(await t.prisma.account.findUniqueOrThrow({ where: { id: r.accountId } })).toMatchObject({ companyName: 'Riad Pilot', seatLimit: 3 });
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: r.userId } })).toMatchObject({ accountId: r.accountId, role: 'OWNER_MANAGER', email: 'pilot@x.test' });
    expect(await t.prisma.auditLog.findMany({ where: { accountId: r.accountId } })).toEqual([
      expect.objectContaining({ action: 'account.signup', actorId: null, resourceId: r.accountId }),
    ]);

    await client(t.app).post('/api/auth/forgot-password', { email: 'pilot@x.test' }).expect(204);
    const token = await t.mail.waitFor('pilot@x.test', 1);
    await client(t.app).post('/api/auth/reset-password', { token, password: 'pilot-chosen-password' }).expect(204);
    await client(t.app).post('/api/auth/login', { email: 'pilot@x.test', password: 'pilot-chosen-password' }).expect(200);
  });

  it('refuses an e-mail that already has an account and creates nothing', async () => {
    expect((await createAccount(t.prisma, input)).ok).toBe(true);
    expect(await createAccount(t.prisma, { ...input, companyName: 'Other' })).toEqual({ ok: false, code: 'EMAIL_IN_USE' });
    expect(await t.prisma.account.count()).toBe(1);
  });

  it('is the only way in: public signup stays closed', async () => {
    await client(t.app).post('/api/auth/signup', { companyName: 'X Co', name: 'X Person', email: 'x@x.test', password: 'a-long-password' }).expect(404);
  });
});
