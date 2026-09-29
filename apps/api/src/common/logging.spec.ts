import { Body, Controller, Get, INestApplication, Logger, Module, Post } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import request from 'supertest';
import { Public } from '../auth/decorators';
import { createTestApp } from '../test/test-app';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from './csrf.guard';
import { RedactingLogger } from './redacting-logger';

/** Fake personal data. Nothing below may reach a log line. */
const PII = {
  name: 'Fatima Zahra Benali',
  email: 'fatima.benali@example.com',
  docNumber: 'XK1234567',
  mrz: 'P<MARBENALI<<FATIMA<ZAHRA<<<<<<<<<<<<<<<<<<<<',
  phone: '+212 6 12 34 56 78',
};

class GuestDto {
  @IsEmail()
  email!: string;
  @IsString()
  name!: string;
}

@Public()
@Controller('logtest')
class LogTestController {
  private readonly logger = new Logger('LogTest');

  @Post('guest')
  guest(@Body() dto: GuestDto) {
    // Deliberately unsafe: proves the backstop, not a pattern to copy.
    this.logger.log(`saved ${dto.email} ${dto.name}`);
    this.logger.warn({ guest: { name: dto.name, documentNumber: PII.docNumber }, id: 'g1' });
    return { ok: true };
  }

  @Get('boom')
  boom() {
    throw new Error(`insert failed for ${PII.name} ${PII.docNumber} ${PII.mrz} ${PII.phone}`);
  }
}

@Module({ controllers: [LogTestController] })
class LogTestModule {}

describe('logging keeps personal data out of the logs', () => {
  let app: INestApplication;
  let output = '';
  const writes: jest.SpyInstance[] = [];

  beforeAll(async () => {
    for (const stream of [process.stdout, process.stderr]) {
      writes.push(
        jest.spyOn(stream, 'write').mockImplementation(((chunk: string | Uint8Array) => {
          output += String(chunk);
          return true;
        }) as typeof process.stdout.write),
      );
    }
    ({ app } = await createTestApp({ extra: [LogTestModule], logger: new RedactingLogger() }));
  });

  afterAll(async () => {
    writes.forEach((w) => w.mockRestore());
    await app.close();
  });

  beforeEach(() => {
    output = '';
  });

  const expectClean = () => {
    for (const value of Object.values(PII)) expect(output).not.toContain(value);
    expect(output).not.toContain('Benali');
  };

  it('redacts an unsafe log line (emails, names under sensitive keys, document numbers)', async () => {
    await request(app.getHttpServer())
      .post('/api/logtest/guest')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .send({ email: PII.email, name: PII.name })
      .expect(201);
    expect(output).toContain('LogTest');
    expect(output).toContain('g1');
    expect(output).not.toContain(PII.email);
    expect(output).not.toContain(PII.docNumber);
    expect(output).not.toContain(`${PII.name}"`);
  });

  it('logs an unexpected error by type and stack only: no message, so no data quoted in it', async () => {
    await request(app.getHttpServer()).get('/api/logtest/boom').expect(500);
    expect(output).toContain('HttpException');
    expect(output).toContain('Error');
    expectClean();
  });

  it('does not echo rejected input in the response or the logs', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/logtest/guest')
      .set(CSRF_HEADER, CSRF_HEADER_VALUE)
      .send({ email: PII.phone, name: 42, docNumber: PII.docNumber })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain(PII.docNumber);
    expect(output).not.toContain(PII.docNumber);
    expect(output).not.toContain(PII.phone);
  });
});
