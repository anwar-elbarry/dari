/* Shared harness for HTTP tests. Integration tests (*.int-spec.ts) need a real Postgres via DATABASE_URL. */
import { INestApplication, LoggerService, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../common/configure-app';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../common/csrf.guard';
import { AppConfig, parseEnv } from '../config/env';
import { MAIL_DRIVER, MailDriver, MailMessage } from '../mail/mail.types';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS, RedisClient } from '../redis/redis.module';
import { hashPassword } from '../auth/auth.service';

export class CapturingMailDriver implements MailDriver {
  readonly sent: (MailMessage & { from: string })[] = [];
  async send(message: MailMessage & { from: string }) {
    this.sent.push(message);
  }
  /** Extracts the `token` query parameter from the last message sent to `to`. */
  lastToken(to: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === to);
    const match = msg?.text.match(/[?&#]token=([A-Za-z0-9_-]+)/);
    if (!match) throw new Error(`No token mail found for ${to}`);
    return match[1];
  }
  /** For mails sent after the response (password reset): waits until `count` messages reached `to`. */
  async waitFor(to: string, count: number, timeoutMs = 3000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (this.sent.filter((m) => m.to === to).length < count) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for mail #${count} to ${to}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.lastToken(to);
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisClient;
  mail: CapturingMailDriver;
  config: AppConfig;
}

/** Redis for tests comes from TEST_REDIS_URL only (it is flushed by resetDatabase); REDIS_URL is ignored. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://u:p@localhost:5432/unused',
    ...(TEST_REDIS_URL ? { REDIS_URL: TEST_REDIS_URL } : {}),
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-000',
    ICAL_FETCH_TIMEOUT_MS: '1500',
    RATE_LIMIT_ENABLED: 'false',
    // Fiche PDFs: this sandbox runs as root, where Chromium needs --no-sandbox; PW_CHROMIUM_PATH points at the browser.
    PDF_NO_SANDBOX: 'true',
    ...(process.env.PW_CHROMIUM_PATH ? { PDF_CHROMIUM_PATH: process.env.PW_CHROMIUM_PATH } : {}),
    ...overrides,
  });
}

export async function createTestApp(opts: { env?: Record<string, string>; extra?: ModuleMetadata['imports']; logger?: LoggerService } = {}): Promise<TestApp> {
  const config = testConfig(opts.env);
  const mail = new CapturingMailDriver();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config), ...(opts.extra ?? [])] })
    .overrideProvider(MAIL_DRIVER)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: opts.logger ?? false });
  configureApp(app, config);
  await app.init();
  return { app, prisma: app.get(PrismaService), redis: app.get<RedisClient>(REDIS), mail, config };
}

export function requireDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Integration tests need DATABASE_URL pointing at a migrated, disposable Postgres database.');
  }
}

/** Empties every table (keeps the migration history) and the test Redis. Only for disposable test stores. */
export async function resetDatabase(prisma: PrismaService, redis: RedisClient = null) {
  if (redis) await redis.flushdb();
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
    /** multipart/form-data with one file field named "file" and optional text fields. */
    upload: (url: string, file: string | Buffer, fields: Record<string, string> = {}, filename = 'import.csv') => {
      let req = agent.post(url).set(CSRF_HEADER, CSRF_HEADER_VALUE).attach('file', Buffer.from(file), filename);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req;
    },
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

export type RoleName = 'OWNER_MANAGER' | 'STAFF' | 'ACCOUNTANT';

export interface SeededAccount {
  accountId: string;
  users: Record<RoleName, { id: string; email: string }>;
  as: Record<RoleName | 'ANON', Client>;
}

/** An account with one logged-in user per role. `label` keeps emails unique across accounts. */
export async function seedAccount(t: TestApp, label: string): Promise<SeededAccount> {
  const passwordHash = await hashPassword(PASSWORD);
  const account = await t.prisma.account.create({ data: { companyName: `${label} Conciergerie` } });
  const roles: RoleName[] = ['OWNER_MANAGER', 'STAFF', 'ACCOUNTANT'];
  const users = {} as SeededAccount['users'];
  const as = { ANON: client(t.app) } as SeededAccount['as'];
  for (const role of roles) {
    const email = `${role.toLowerCase()}@${label.toLowerCase()}.test`;
    const user = await t.prisma.user.create({ data: { accountId: account.id, name: `${label} ${role}`, email, role, passwordHash } });
    users[role] = { id: user.id, email };
    as[role] = client(t.app);
    await as[role].post('/api/auth/login', { email, password: PASSWORD }).expect(200);
  }
  return { accountId: account.id, users, as };
}
