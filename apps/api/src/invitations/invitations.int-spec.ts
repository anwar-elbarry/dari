import { hashToken } from '../auth/tokens';
import { client, createTestApp, PASSWORD, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

describe('invitations (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    t.mail.sent.length = 0;
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
  });

  const invite = (email: string, role = 'STAFF') => a.as.OWNER_MANAGER.post('/api/invitations', { email, role });

  it('creates an invitation, mails a link, and lists it without secrets', async () => {
    const res = await invite('New.Staff@x.test').expect(201);
    expect(res.body).toEqual({ id: expect.any(String), email: 'new.staff@x.test', role: 'STAFF', expiresAt: expect.any(String), createdAt: expect.any(String) });

    const mail = t.mail.sent.at(-1)!;
    expect(mail.to).toBe('new.staff@x.test');
    expect(mail.text).toContain(`${t.config.APP_URL}/accept-invitation#token=`);
    expect(mail.text).toContain('Alpha Conciergerie');

    const list = await a.as.OWNER_MANAGER.get('/api/invitations').expect(200);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    expect(await t.prisma.auditLog.count({ where: { action: 'invitation.created' } })).toBe(1);
  });

  it('only invites Staff or Accountant', async () => {
    await invite('boss@x.test', 'OWNER_MANAGER').expect(400);
  });

  it('refuses an email that already has an account', async () => {
    const res = await invite(b.users.STAFF.email).expect(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('previews and accepts: the role comes from the invitation, and a session starts', async () => {
    await invite('acc@x.test', 'ACCOUNTANT').expect(201);
    const token = t.mail.lastToken('acc@x.test');

    const preview = await client(t.app).post('/api/invitations/preview', { token }).expect(200);
    expect(preview.body).toMatchObject({ email: 'acc@x.test', role: 'ACCOUNTANT', companyName: 'Alpha Conciergerie' });

    await client(t.app).post('/api/invitations/accept', { token, name: 'Nadia', password: PASSWORD, role: 'OWNER_MANAGER' }).expect(400);

    const c = client(t.app);
    await c.post('/api/invitations/accept', { token, name: 'Nadia', password: PASSWORD }).expect(201);
    const me = await c.get('/api/me').expect(200);
    expect(me.body.user).toMatchObject({ email: 'acc@x.test', role: 'ACCOUNTANT', name: 'Nadia' });
    expect(me.body.account.id).toBe(a.accountId);

    expect((await a.as.OWNER_MANAGER.get('/api/invitations')).body).toHaveLength(0);
    expect(await t.prisma.auditLog.count({ where: { action: 'invitation.accepted' } })).toBe(1);
  });

  it('refuses a used, revoked, replaced or expired token', async () => {
    await invite('once@x.test').expect(201);
    const used = t.mail.lastToken('once@x.test');
    await client(t.app).post('/api/invitations/accept', { token: used, name: 'Once', password: PASSWORD }).expect(201);
    const again = await client(t.app).post('/api/invitations/accept', { token: used, name: 'Once', password: PASSWORD }).expect(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');

    const first = await invite('twice@x.test').expect(201);
    const replacedToken = t.mail.lastToken('twice@x.test');
    await invite('twice@x.test').expect(201);
    await client(t.app).post('/api/invitations/preview', { token: replacedToken }).expect(400);
    expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: first.body.id } })).revokedAt).not.toBeNull();

    const revoked = await invite('rev@x.test').expect(201);
    const revokedToken = t.mail.lastToken('rev@x.test');
    await a.as.OWNER_MANAGER.delete(`/api/invitations/${revoked.body.id}`).expect(204);
    await client(t.app).post('/api/invitations/accept', { token: revokedToken, name: 'Rev', password: PASSWORD }).expect(400);

    await invite('late@x.test').expect(201);
    const lateToken = t.mail.lastToken('late@x.test');
    await t.prisma.invitation.update({ where: { tokenHash: hashToken(lateToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await client(t.app).post('/api/invitations/accept', { token: lateToken, name: 'Late', password: PASSWORD }).expect(400);
  });

  it('keeps invitations inside their account', async () => {
    const res = await invite('mine@x.test').expect(201);
    expect((await b.as.OWNER_MANAGER.get('/api/invitations')).body).toHaveLength(0);
    await b.as.OWNER_MANAGER.delete(`/api/invitations/${res.body.id}`).expect(404);
    expect((await a.as.OWNER_MANAGER.get('/api/invitations')).body).toHaveLength(1);
  });

  it('revokes the invitation if the email cannot be sent', async () => {
    const send = t.mail.send;
    t.mail.send = async () => {
      throw new Error('smtp down');
    };
    try {
      const res = await invite('down@x.test').expect(503);
      expect(res.body.error.code).toBe('MAIL_FAILED');
    } finally {
      t.mail.send = send;
    }
    expect((await a.as.OWNER_MANAGER.get('/api/invitations')).body).toHaveLength(0);
  });
});
