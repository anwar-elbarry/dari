import request from 'supertest';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { hashToken } from './tokens';
import { client, createTestApp, PASSWORD, requireDatabase, resetDatabase, signup, TestApp } from '../test/test-app';

requireDatabase();

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].slice(name.length + 1);
}

describe('auth (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
  });

  describe('secure deployments (__Host- cookies)', () => {
    it('issues __Host- cookies and accepts them back; the short names are ignored', async () => {
      const secure = await createTestApp({ env: { COOKIE_SECURE: 'true' } });
      try {
        const res = await request(secure.app.getHttpServer())
          .post('/api/auth/signup')
          .set('X-Requested-With', 'dari')
          .send({ companyName: 'Riad Co', name: 'Sara', email: 'sara@example.test', password: PASSWORD })
          .expect(201);
        const set = res.headers['set-cookie'] as unknown as string[];
        expect(set.join('\n')).toMatch(/__Host-dari_at=[^;]+;.*Path=\/;.*HttpOnly;.*Secure;.*SameSite=Lax/);
        expect(set.join('\n')).toMatch(/__Host-dari_rt=[^;]+;.*Path=\/;.*HttpOnly;.*Secure;.*SameSite=Lax/);
        expect(set.join('\n')).not.toMatch(/Domain=/i);

        const at = /__Host-dari_at=([^;]+)/.exec(set.join('\n'))![1];
        await request(secure.app.getHttpServer()).get('/api/me').set('Cookie', `__Host-dari_at=${at}`).expect(200);
        await request(secure.app.getHttpServer()).get('/api/me').set('Cookie', `dari_at=${at}`).expect(401);
      } finally {
        await secure.app.close();
      }
    });
  });

  describe('signup', () => {
    it('creates the account and first Owner/Manager, starts a session with safe cookies', async () => {
      const c = client(t.app);
      const res = await c
        .post('/api/auth/signup', { companyName: 'Riad Co', name: 'Sara', email: '  Sara@Example.TEST ', password: PASSWORD })
        .expect(201);

      const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(cookies).toMatch(/dari_at=[^;]+;.*Path=\/api;.*HttpOnly;.*SameSite=Lax/);
      expect(cookies).toMatch(/dari_rt=[^;]+;.*Path=\/api\/auth;.*HttpOnly;.*SameSite=Lax/);

      const me = await c.get('/api/me').expect(200);
      expect(me.body.user).toMatchObject({ email: 'sara@example.test', role: 'OWNER_MANAGER', name: 'Sara' });
      expect(me.body.account).toMatchObject({ companyName: 'Riad Co', subscriptionTier: 'STARTER' });
      expect(me.body.user.passwordHash).toBeUndefined();

      const audit = await t.prisma.auditLog.findMany();
      expect(audit.map((a) => a.action)).toEqual(['account.signup']);
    });

    it('refuses a taken email regardless of case', async () => {
      await signup(t.app, 'a@x.test');
      const res = await client(t.app)
        .post('/api/auth/signup', { companyName: 'Other', name: 'Bob', email: 'A@X.test', password: PASSWORD })
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_IN_USE');
      expect(await t.prisma.account.count()).toBe(1);
    });

    it('rejects weak passwords and unknown fields such as role', async () => {
      const res = await client(t.app)
        .post('/api/auth/signup', { companyName: 'X Co', name: 'X', email: 'x@x.test', password: 'short', role: 'ACCOUNTANT' })
        .expect(400);
      const fields = res.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['password', 'role']));
    });
  });

  describe('login', () => {
    it('gives the same answer for an unknown email and a wrong password', async () => {
      await signup(t.app, 'known@x.test');
      const unknown = await client(t.app).post('/api/auth/login', { email: 'nobody@x.test', password: PASSWORD }).expect(401);
      const wrong = await client(t.app).post('/api/auth/login', { email: 'known@x.test', password: 'wrong-password' }).expect(401);
      expect(unknown.body.error).toEqual(wrong.body.error);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('logs in, records lastLoginAt and audits success and failure', async () => {
      await signup(t.app, 'm@x.test');
      await client(t.app).post('/api/auth/login', { email: 'm@x.test', password: 'wrong-password' }).expect(401);
      const c = client(t.app);
      await c.post('/api/auth/login', { email: 'M@x.test', password: PASSWORD }).expect(200);
      await c.get('/api/me').expect(200);

      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'm@x.test' } });
      expect(user.lastLoginAt).not.toBeNull();
      const actions = (await t.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['account.signup', 'auth.login.failure', 'auth.login.success']);
    });

    it('counts parallel guesses before verifying them', async () => {
      await signup(t.app, 'burst@x.test');
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => client(t.app).post('/api/auth/login', { email: 'burst@x.test', password: `guess-${i}-password` })),
      );
      expect(results.filter((r) => r.status === 401)).toHaveLength(5);
      expect(results.filter((r) => r.status === 429)).toHaveLength(15);
    });

    it('blocks an email after 5 failures, even with the right password', async () => {
      await signup(t.app, 'brute@x.test');
      for (let i = 0; i < 5; i++) {
        await client(t.app).post('/api/auth/login', { email: 'brute@x.test', password: `wrong-${i}-password` }).expect(401);
      }
      const res = await client(t.app).post('/api/auth/login', { email: 'brute@x.test', password: PASSWORD }).expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('refuses disabled users, including their existing sessions', async () => {
      const c = await signup(t.app, 'gone@x.test');
      await t.prisma.user.update({ where: { email: 'gone@x.test' }, data: { disabledAt: new Date() } });
      await c.get('/api/me').expect(401);
      await client(t.app).post('/api/auth/login', { email: 'gone@x.test', password: PASSWORD }).expect(401);
    });

    it('rejects a tampered access token', async () => {
      await request(t.app.getHttpServer()).get('/api/me').set('Cookie', 'dari_at=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.').expect(401);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token', async () => {
      const c = await signup(t.app, 'r@x.test');
      const res = await c.post('/api/auth/refresh').expect(200);
      expect(cookieValue(res, 'dari_rt')).toBeDefined();
      await c.get('/api/me').expect(200);
      const tokens = await t.prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
      expect(tokens).toHaveLength(2);
      expect(tokens[0].revokedAt).not.toBeNull();
      expect(tokens[0].replacedById).toBe(tokens[1].id);
    });

    it('treats an old token within the grace window as a tab race, without revoking the session', async () => {
      const c = client(t.app);
      const first = await c.post('/api/auth/signup', { companyName: 'Race Co', name: 'Rita', email: 'race@x.test', password: PASSWORD });
      const oldRefresh = cookieValue(first, 'dari_rt')!;
      await c.post('/api/auth/refresh').expect(200);

      const raced = await request(t.app.getHttpServer())
        .post('/api/auth/refresh')
        .set(CSRF_HEADER, CSRF_HEADER_VALUE)
        .set('Cookie', `dari_rt=${oldRefresh}`)
        .expect(401);
      expect(raced.body.error.code).toBe('REFRESH_RACE');
      await c.post('/api/auth/refresh').expect(200);
    });

    it('revokes every session when a rotated token is reused after the grace window', async () => {
      const c = client(t.app);
      const first = await c.post('/api/auth/signup', { companyName: 'Theft Co', name: 'Tom', email: 'theft@x.test', password: PASSWORD });
      const stolen = cookieValue(first, 'dari_rt')!;
      await c.post('/api/auth/refresh').expect(200);
      await t.prisma.refreshToken.update({ where: { tokenHash: hashToken(stolen) }, data: { revokedAt: new Date(Date.now() - 60_000) } });

      const res = await request(t.app.getHttpServer())
        .post('/api/auth/refresh')
        .set(CSRF_HEADER, CSRF_HEADER_VALUE)
        .set('Cookie', `dari_rt=${stolen}`)
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_SESSION');
      await c.post('/api/auth/refresh').expect(401);
      expect(await t.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
      expect(await t.prisma.auditLog.count({ where: { action: 'auth.refresh_token.reuse_detected' } })).toBe(1);
    });

    it('refuses expired and missing tokens', async () => {
      const c = await signup(t.app, 'exp@x.test');
      await t.prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await c.post('/api/auth/refresh').expect(401);
      await client(t.app).post('/api/auth/refresh').expect(401);
    });
  });

  it('logout revokes the refresh token and clears cookies', async () => {
    const c = await signup(t.app, 'out@x.test');
    const res = await c.post('/api/auth/logout').expect(204);
    expect((res.headers['set-cookie'] as unknown as string[]).join('\n')).toMatch(/dari_rt=;/);
    expect(await t.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    await c.post('/api/auth/refresh').expect(401);
  });

  describe('password reset', () => {
    it('does not reveal whether an email exists', async () => {
      await client(t.app).post('/api/auth/forgot-password', { email: 'ghost@x.test' }).expect(204);
      await new Promise((r) => setTimeout(r, 200));
      expect(t.mail.sent).toHaveLength(0);
    });

    it('resets once, revokes sessions, and the new password works', async () => {
      const session = await signup(t.app, 'reset@x.test');
      await client(t.app).post('/api/auth/forgot-password', { email: 'Reset@x.test' }).expect(204);
      const token = await t.mail.waitFor('reset@x.test', 1);
      expect(t.mail.sent.at(-1)?.text).toContain(`${t.config.APP_URL}/reset-password#token=`);

      const newPassword = 'a-brand-new-password';
      await client(t.app).post('/api/auth/reset-password', { token, password: newPassword }).expect(204);
      const reused = await client(t.app).post('/api/auth/reset-password', { token, password: 'another-new-password' }).expect(400);
      expect(reused.body.error.code).toBe('INVALID_TOKEN');

      await session.post('/api/auth/refresh').expect(401);
      await client(t.app).post('/api/auth/login', { email: 'reset@x.test', password: PASSWORD }).expect(401);
      await client(t.app).post('/api/auth/login', { email: 'reset@x.test', password: newPassword }).expect(200);
    });

    it('refuses an expired token and invalidates older tokens when a new one is requested', async () => {
      await signup(t.app, 'old@x.test');
      await client(t.app).post('/api/auth/forgot-password', { email: 'old@x.test' }).expect(204);
      const first = await t.mail.waitFor('old@x.test', 1);
      // A second request within two minutes sends nothing (see the limits test below): move the first one back in time.
      await t.prisma.passwordResetToken.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      await client(t.app).post('/api/auth/forgot-password', { email: 'old@x.test' }).expect(204);
      const second = await t.mail.waitFor('old@x.test', 2);

      await client(t.app).post('/api/auth/reset-password', { token: first, password: 'a-brand-new-password' }).expect(400);
      await t.prisma.passwordResetToken.updateMany({ where: { tokenHash: hashToken(second) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await client(t.app).post('/api/auth/reset-password', { token: second, password: 'a-brand-new-password' }).expect(400);
    });
  });

  describe('password reset limits per address', () => {
    it('sends no second link within two minutes, so a flood cannot invalidate the link the owner just received', async () => {
      await signup(t.app, 'flood@x.test');
      await client(t.app).post('/api/auth/forgot-password', { email: 'flood@x.test' }).expect(204);
      const first = await t.mail.waitFor('flood@x.test', 1);
      for (let i = 0; i < 3; i++) await client(t.app).post('/api/auth/forgot-password', { email: 'flood@x.test' }).expect(204);
      await new Promise((r) => setTimeout(r, 300));
      expect(t.mail.sent.filter((m) => m.to === 'flood@x.test')).toHaveLength(1);
      await client(t.app).post('/api/auth/reset-password', { token: first, password: 'a-brand-new-password' }).expect(204); // still valid
    });

    it('sends at most three links an hour to one address, and answers 204 either way', async () => {
      await signup(t.app, 'cap@x.test');
      for (let i = 0; i < 5; i++) {
        await t.prisma.passwordResetToken.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } }); // past the two-minute gap
        await client(t.app).post('/api/auth/forgot-password', { email: 'cap@x.test' }).expect(204);
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(t.mail.sent.filter((m) => m.to === 'cap@x.test')).toHaveLength(3);
    });
  });

  describe('access tokens after a session is cut off', () => {
    /** Signs up and returns the raw cookies, as a thief who copied them would hold them. */
    async function cookiesOf(email: string) {
      const res = await request(t.app.getHttpServer()).post('/api/auth/signup').set(CSRF_HEADER, CSRF_HEADER_VALUE).send({ companyName: 'Riad Co', name: 'Sara', email, password: PASSWORD }).expect(201);
      return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    }
    const me = (cookies: string) => request(t.app.getHttpServer()).get('/api/me').set('Cookie', cookies);
    const wholeSecond = () => new Promise((r) => setTimeout(r, 1100)); // `iat` and the revocation instant are whole seconds

    it('a stolen access cookie stops working once the password is reset', async () => {
      const stolen = await cookiesOf('stolen@x.test');
      await me(stolen).expect(200);
      await wholeSecond();
      await client(t.app).post('/api/auth/forgot-password', { email: 'stolen@x.test' }).expect(204);
      const token = await t.mail.waitFor('stolen@x.test', 1);
      await client(t.app).post('/api/auth/reset-password', { token, password: 'a-brand-new-password' }).expect(204);
      await me(stolen).expect(401);
      // A fresh login after the reset works.
      const again = client(t.app);
      await again.post('/api/auth/login', { email: 'stolen@x.test', password: 'a-brand-new-password' }).expect(200);
      await again.get('/api/me').expect(200);
    });

    it('logout also ends the access token, not only the refresh token', async () => {
      const cookies = await cookiesOf('bye@x.test');
      await me(cookies).expect(200);
      await wholeSecond();
      await request(t.app.getHttpServer()).post('/api/auth/logout').set(CSRF_HEADER, CSRF_HEADER_VALUE).set('Cookie', cookies).expect(204);
      await me(cookies).expect(401);
    });

    it('reuse of a rotated refresh token also cuts off access tokens', async () => {
      const cookies = await cookiesOf('reuse@x.test');
      const oldRt = /dari_rt=([^;]+)/.exec(cookies)![1];
      await request(t.app.getHttpServer()).post('/api/auth/refresh').set(CSRF_HEADER, CSRF_HEADER_VALUE).set('Cookie', cookies).expect(200);
      await wholeSecond();
      await t.prisma.refreshToken.updateMany({ where: { replacedById: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } }); // outside the grace window
      await request(t.app.getHttpServer()).post('/api/auth/refresh').set(CSRF_HEADER, CSRF_HEADER_VALUE).set('Cookie', `dari_rt=${oldRt}`).expect(401);
      await me(cookies).expect(401);
    });
  });

  describe('session lifetime', () => {
    it('refuses to rotate a login older than REFRESH_MAX_LIFETIME_DAYS, and carries the start over on every rotation', async () => {
      const c = await signup(t.app, 'old-session@x.test');
      await c.post('/api/auth/refresh').expect(200);
      const [first, second] = await t.prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
      expect(second.familyStartedAt.getTime()).toBe(first.familyStartedAt.getTime());
      await t.prisma.refreshToken.updateMany({ data: { familyStartedAt: new Date(Date.now() - (t.config.REFRESH_MAX_LIFETIME_DAYS + 1) * 86_400_000) } });
      await c.post('/api/auth/refresh').expect(401);
    });
  });

  describe('signup flag', () => {
    it('answers 404 when SIGNUP_ENABLED is off, and creates nothing', async () => {
      const closed = await createTestApp({ env: { SIGNUP_ENABLED: 'false' } });
      try {
        await resetDatabase(closed.prisma, closed.redis);
        await client(closed.app).post('/api/auth/signup', { companyName: 'Riad Co', name: 'Sara', email: 'closed@x.test', password: PASSWORD }).expect(404);
        expect(await closed.prisma.user.count()).toBe(0);
        await client(closed.app).post('/api/auth/login', { email: 'nobody@x.test', password: PASSWORD }).expect(401); // the rest of auth is unaffected
      } finally {
        await closed.app.close();
      }
    });
  });

  it('never writes passwords or tokens to the audit log', async () => {
    const c = await signup(t.app, 'audit@x.test');
    await c.post('/api/auth/refresh').expect(200);
    await client(t.app).post('/api/auth/login', { email: 'audit@x.test', password: 'wrong-password' });
    await client(t.app).post('/api/auth/forgot-password', { email: 'audit@x.test' });
    const token = await t.mail.waitFor('audit@x.test', 1);
    const dump = JSON.stringify(await t.prisma.auditLog.findMany());
    for (const secret of [PASSWORD, 'wrong-password', token, hashToken(token)]) expect(dump).not.toContain(secret);
  });
});

describe('auth rate limits (integration)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
    await resetDatabase(t.prisma, t.redis);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('limits login attempts per IP to 10 per minute', async () => {
    for (let i = 0; i < 10; i++) {
      await client(t.app).post('/api/auth/login', { email: `ip${i}@x.test`, password: PASSWORD }).expect(401);
    }
    const res = await client(t.app).post('/api/auth/login', { email: 'ip10@x.test', password: PASSWORD }).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});
