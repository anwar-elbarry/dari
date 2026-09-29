/* Shared harness for HTTP tests. Integration tests (*.int-spec.ts) need a real Postgres via DATABASE_URL. */
import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../common/configure-app';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { AppConfig, parseEnv } from '../config/env';
import { MAIL_DRIVER, MailDriver, MailMessage } from '../mail/mail.types';
import { PrismaService } from '../prisma/prisma.service';

export class CapturingMailDriver implements MailDriver {
  readonly sent: (MailMessage & { from: string })[] = [];
  async send(message: MailMessage & { from: string }) {
    this.sent.push(message);
  }
  /** Extracts the `token` query parameter from the last message sent to `to`. */
  lastToken(to: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    const match = msg?.text.match(/[?&]token=([A-Za-z0-9_-]+)/);
    if (!match) throw new Error(`No token mail found for ${to}`);
    return match[1];
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mail: CapturingMailDriver;
  config: AppConfig;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://u:p@localhost:5432/unused',
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-000',
    RATE_LIMIT_ENABLED: 'false',
    ...overrides,
  });
}

export async function createTestApp(opts: { env?: Record<string, string>; extra?: ModuleMetadata['imports'] } = {}): Promise<TestApp> {
  const config = testConfig(opts.env);
  const mail = new CapturingMailDriver();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config), ...(opts.extra ?? [])] })
    .overrideProvider(MAIL_DRIVER)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();
  return { app, prisma: app.get(PrismaService), mail, config };
}

export function requireDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Integration tests need DATABASE_URL pointing at a migrated, disposable Postgres database.');
  }
}

/** Empties every table (keeps the migration history). Only for disposable test databases. */
export async function resetDatabase(prisma: PrismaService) {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) throw new Error('Refusing to reset a database whose URL does not contain "test".');
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
  }
}

/** Cookie-keeping client that adds the CSRF header to every request. */
export function client(app: INestApplication) {
  const agent = request.agent(app.getHttpServer());
  return {
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set(CSRF_HEADER, CSRF_HEADER_VALUE).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set(CSRF_HEADER, CSRF_HEADER_VALUE).send(body ?? {}),
    delete: (url: string) => agent.delete(url).set(CSRF_HEADER, CSRF_HEADER_VALUE),
    agent,
  };
}

export type Client = ReturnType<typeof client>;

export const PASSWORD = 'correct-horse-battery';

/** Signs up a new account and returns its logged-in client. */
export async function signup(app: INestApplication, email: string, companyName = 'Acme Conciergerie'): Promise<Client> {
  const c = client(app);
  await c.post('/api/auth/signup', { companyName, name: 'Manager', email, password: PASSWORD }).expect(201);
  return c;
}
