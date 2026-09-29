import { Body, Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { IsEmail, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import request from 'supertest';
import { Public } from '../auth/decorators';
import { createTestApp } from '../test/test-app';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './csrf.guard';

class AddressDto {
  @IsString()
  @MinLength(2)
  city!: string;
}

class EchoDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

@Public()
@Controller('test')
class TestController {
  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }

  @Get('boom')
  boom() {
    throw new Error('database password is hunter2');
  }
}

@Module({ controllers: [TestController] })
class TestFeatureModule {}

async function createApp(env: Record<string, string> = {}): Promise<INestApplication> {
  return (await createTestApp({ env, extra: [TestFeatureModule] })).app;
}

describe('HTTP pipeline', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health under /api with a request id and security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('keeps a well-formed incoming request id and replaces a malformed one', async () => {
    const kept = await request(app.getHttpServer()).get('/api/health').set('x-request-id', 'abc-12345678');
    expect(kept.headers['x-request-id']).toBe('abc-12345678');

    const replaced = await request(app.getHttpServer()).get('/api/health').set('x-request-id', '<script>');
    expect(replaced.headers['x-request-id']).not.toBe('<script>');
  });

  it('returns 404 in the standard error shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects invalid and unknown fields with field-level details, without echoing values', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test/echo')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .send({ email: 'not-an-email', address: { city: 'M' }, role: 'OWNER_MANAGER' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'address.city', 'role']));
    expect(JSON.stringify(res.body)).not.toContain('not-an-email');
  });

  it('accepts a valid body', async () => {
    const body = { email: 'a@b.test', address: { city: 'Marrakech' } };
    await request(app.getHttpServer()).post('/api/test/echo').set(CSRF_HEADER, CSRF_HEADER_VALUE).send(body).expect(201, body);
  });

  it('does not echo malformed JSON back in the error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test/echo')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .set('Content-Type', 'application/json')
      .send('{"email":"a@b.test","password":hunter2-SECRET}')
      .expect(400);
    expect(res.body.error).toEqual({ code: 'BAD_REQUEST', message: 'Bad request.' });
  });

  it('answers 413, not 500, to an oversized body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/test/echo')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .send({ email: 'a@b.test', padding: 'x'.repeat(200_000) })
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await request(app.getHttpServer()).post('/api/test/echo').send({}).expect(403);
    expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
  });

  it('requires a session on non-public routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(app.getHttpServer()).get('/api/test/boom').expect(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});

describe('rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ RATE_LIMIT_ENABLED: 'true', THROTTLE_LIMIT: '3', THROTTLE_TTL_MS: '60000' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 in the standard error shape once the limit is reached', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) await request(server).get('/api/health').expect(200);
    const res = await request(server).get('/api/health').expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});
