import { client, createTestApp, PASSWORD, requireDatabase, resetDatabase, TestApp } from '../test/test-app';

requireDatabase();

describe('signup switched off (integration)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { SIGNUP_ENABLED: 'false' } });
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
  });

  it('answers 403 SIGNUP_CLOSED and creates nothing, and does not hash the password', async () => {
    const res = await client(t.app).post('/api/auth/signup', { companyName: 'Riad Co', name: 'Sara', email: 'sara@example.test', password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('SIGNUP_CLOSED');
    expect(await t.prisma.account.count()).toBe(0);
    expect(await t.prisma.user.count()).toBe(0);
  });

  it('does not reveal whether an address is registered while closed', async () => {
    const account = await t.prisma.account.create({ data: { companyName: 'Existing' } });
    await t.prisma.user.create({ data: { accountId: account.id, name: 'U', email: 'taken@example.test', role: 'OWNER_MANAGER', passwordHash: 'x' } });
    const res = await client(t.app).post('/api/auth/signup', { companyName: 'Riad Co', name: 'Sara', email: 'taken@example.test', password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('SIGNUP_CLOSED');
  });

  it('leaves login working', async () => {
    await client(t.app).post('/api/auth/login', { email: 'nobody@example.test', password: PASSWORD }).expect(401);
  });
});
