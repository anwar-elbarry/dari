import { LoginLimiter, RedisLoginLimiter } from '../auth/login-limiter';
import { RedisThrottlerStorage } from '../common/redis-throttler.storage';
import { createTestApp, requireDatabase, resetDatabase, TEST_REDIS_URL, TestApp } from '../test/test-app';

requireDatabase();
const describeRedis = TEST_REDIS_URL ? describe : describe.skip;

describeRedis('Redis-backed limiters (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t.prisma, t.redis);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('counts parallel login attempts atomically', async () => {
    const l = new RedisLoginLimiter(t.redis!);
    const counts = await Promise.all(Array.from({ length: 20 }, () => l.recordAttempt('p@x.test')));
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(counts.filter((c) => !LoginLimiter.blocked(c))).toHaveLength(5);
    await l.reset('p@x.test');
    expect(await l.recordAttempt('p@x.test')).toBe(1);
    expect(await t.redis!.pttl('login-fail:' + Buffer.from('p@x.test').toString('base64url'))).toBeGreaterThan(0);
  });

  it('throttler storage counts, expires and blocks', async () => {
    const s = new RedisThrottlerStorage(t.redis!, 'throttle-test');
    const r1 = await s.increment('ip1', 60_000, 2, 30_000, 'default');
    const r2 = await s.increment('ip1', 60_000, 2, 30_000, 'default');
    const r3 = await s.increment('ip1', 60_000, 2, 30_000, 'default');
    expect([r1.totalHits, r2.totalHits, r3.totalHits]).toEqual([1, 2, 3]);
    expect([r1.isBlocked, r2.isBlocked, r3.isBlocked]).toEqual([false, false, true]);
    expect(r3.timeToBlockExpire).toBeGreaterThan(0);
    expect(r3.timeToExpire).toBeLessThanOrEqual(60);
    const other = await s.increment('ip2', 60_000, 2, 30_000, 'default');
    expect(other.totalHits).toBe(1);
  });
});
