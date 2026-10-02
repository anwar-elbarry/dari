import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { createRedisClient } from '../redis/redis.module';
import { createTestApp } from '../test/test-app';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './csrf.guard';

/**
 * Phase 7.4 drill, kept as a test: with Redis unreachable, the rate limits and the login lockout fail closed, fast,
 * with a 503 that says nothing about the request; health reports the instance as degraded. The app's own client
 * configuration points at a port where nothing listens (the BullMQ queues are not started: they have their own).
 */
describe('Redis down', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    redis = createRedisClient('redis://127.0.0.1:1');
    app = (await createTestApp({ redis, env: { RATE_LIMIT_ENABLED: 'true', GUEST_CHECKIN_ENABLED: 'true', SECURE_SHARE_ENABLED: 'true' } })).app;
  });

  afterAll(async () => {
    redis.disconnect();
    await app?.close();
  });

  it('health answers 503 degraded, without going through the rate limiter', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body).toEqual({ status: 'degraded' });
  });

  it.each([
    ['GET', '/api/share', { 'X-Share-Token': 'A'.repeat(43) }],
    ['GET', '/api/checkin', { 'X-Checkin-Token': 'A'.repeat(43) }],
    ['POST', '/api/auth/login', {}],
  ])('%s %s fails closed within seconds with a neutral 503', async (method, path, headers) => {
    const started = Date.now();
    const req = method === 'GET' ? request(app.getHttpServer()).get(path) : request(app.getHttpServer()).post(path).send({ email: 'nobody@example.invalid', password: 'wrong-password-123' });
    const res = await req.set(CSRF_HEADER, CSRF_HEADER_VALUE).set(headers);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Try again shortly.' });
    expect(res.headers['retry-after']).toBe('30');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
