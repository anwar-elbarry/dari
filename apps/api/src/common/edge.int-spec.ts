import { client, createTestApp, PASSWORD, requireDatabase, resetDatabase, TestApp } from '../test/test-app';

requireDatabase();

/**
 * Phase 7.4, "Edge": what the API does with a forged X-Forwarded-For. The edge proxy must overwrite the header
 * (docs/deployment.md); these tests show that the API does not make a bad situation worse: with one trusted hop it
 * takes the address that hop appended (the right-most entry), never the client-supplied left part, so rotating a fake
 * left entry neither changes the audited address nor escapes the per-address rate limit.
 */
describe('client address behind the proxy (integration)', () => {
  let t: TestApp;
  afterEach(async () => {
    await t.app.close();
  });

  async function signupFrom(forwardedFor: string | undefined, email: string) {
    let req = client(t.app).post('/api/auth/signup', { companyName: 'Edge Test', name: 'Manager', email, password: PASSWORD });
    if (forwardedFor !== undefined) req = req.set('X-Forwarded-For', forwardedFor);
    return req;
  }

  it('audits the address the trusted proxy appended, not the forged part before it', async () => {
    t = await createTestApp({ env: { TRUST_PROXY: '1' } });
    await resetDatabase(t.prisma, t.redis);
    await signupFrom('6.6.6.6, 203.0.113.9', 'edge1@example.test').then((r) => expect(r.status).toBe(201));
    const row = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'account.signup' } });
    expect(row.ip).toBe('203.0.113.9');
  });

  it('with no trusted proxy configured the header is ignored altogether', async () => {
    t = await createTestApp({ env: { TRUST_PROXY: '0' } });
    await resetDatabase(t.prisma, t.redis);
    await signupFrom('6.6.6.6', 'edge2@example.test').then((r) => expect(r.status).toBe(201));
    const row = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'account.signup' } });
    expect(row.ip).not.toContain('6.6.6.6');
  });

  it('rotating a forged left entry does not escape the per-address rate limit', async () => {
    t = await createTestApp({ env: { TRUST_PROXY: '1', RATE_LIMIT_ENABLED: 'true' } });
    await resetDatabase(t.prisma, t.redis);
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await signupFrom(`10.0.0.${i}, 203.0.113.50`, `edge-rl-${i}@example.test`)).status);
    expect(statuses).toContain(429);
    // The limited answers are neutral: no data, never cached.
    const limited = await signupFrom('10.9.9.9, 203.0.113.50', 'edge-rl-x@example.test');
    expect(limited.status).toBe(429);
    expect(limited.headers['cache-control']).toMatch(/no-store/);
  });
});
