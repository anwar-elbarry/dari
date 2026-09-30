import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { DecryptionError, Keyring } from './envelope';
import { MemoryObjectStore } from './memory-object-store';
import { OBJECT_STORE } from './object-store';
import { StorageAudit, StorageService } from './storage.service';

requireDatabase();

const hasPgTools = (() => {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
    execFileSync('pg_restore', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const maybe = hasPgTools ? describe : describe.skip;

const readAudit: StorageAudit = { actorId: 'drill', action: 'guest.document.read', resourceType: 'Drill', resourceId: 'restore-drill' };

/**
 * Restore drill (Phase 7.5): a database dumped and restored on a scratch instance still opens every stored
 * object, and only with the backed-up master keys. The same steps, by hand, are in docs/runbook.md.
 * Skipped when pg_dump / pg_restore are not installed.
 */
maybe('restore drill (integration)', () => {
  let t: TestApp;
  let store: MemoryObjectStore;
  let scratch: PrismaService | null = null;
  const scratchName = `dari_restore_drill_test_${process.pid}`;

  const url = (db: string) => {
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = `/${db}`;
    return u.toString();
  };

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
  });
  afterAll(async () => {
    await scratch?.$disconnect();
    try {
      await t.prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}"`);
    } catch {
      // Best effort: the name carries the process id and "test".
    }
    await t.app.close();
  });

  it('restores on a scratch database; every kind of stored object decrypts with the backed-up keys and only with them', async () => {
    await resetDatabase(t.prisma, t.redis);
    for (const key of store.keys()) await store.delete(key);

    const keys: Keyring = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
    const source = new StorageService(t.prisma, t.app.get(AuditService), store, keys, t.config);
    const account = (await t.prisma.account.create({ data: { companyName: 'Drill' } })).id;
    const samples = [
      ['ID_IMAGE', Buffer.from('SPECIMEN-ID-IMAGE-' + 'x'.repeat(500))],
      ['FICHE_PDF', Buffer.from('%PDF-1.4 specimen fiche')],
      ['POLICE_REGISTER_PDF', Buffer.from('%PDF-1.4 specimen register')],
      ['LICENSE_DOCUMENT', Buffer.from('specimen licence document')],
    ] as const;
    const stored = [];
    for (const [kind, bytes] of samples) stored.push({ kind, bytes, info: await source.put(account, kind, bytes) });

    // Back up: a custom-format dump, then restore it on a scratch database (what the runbook does with the daily backup).
    const dump = execFileSync('pg_dump', ['--format=custom', '--no-owner', '--dbname', process.env.DATABASE_URL!], { maxBuffer: 256 * 1024 * 1024 });
    await t.prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}"`);
    await t.prisma.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);
    execFileSync('pg_restore', ['--no-owner', '--dbname', url(scratchName)], { input: dump, maxBuffer: 256 * 1024 * 1024 });

    scratch = new PrismaService({ datasources: { db: { url: url(scratchName) } } } as never);
    // The restored database is complete: same migration history, same rows.
    const migrations = await scratch.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const original = await t.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(migrations[0].n).toBe(original[0].n);
    expect(await scratch.storedObject.count({ where: { accountId: account } })).toBe(samples.length);

    // With the backed-up keys every object opens and matches its recorded checksum.
    const restored = new StorageService(scratch, t.app.get(AuditService), store, keys, t.config);
    for (const s of stored) {
      const { bytes } = await restored.read(account, s.info.id, readAudit);
      expect(bytes.equals(s.bytes)).toBe(true);
    }

    // Without them (a restore that forgot the key backup) nothing opens: the backup alone is useless to a thief.
    const wrong: Keyring = { currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) };
    const withoutKeys = new StorageService(scratch, t.app.get(AuditService), store, wrong, t.config);
    await expect(withoutKeys.read(account, stored[0].info.id, readAudit)).rejects.toBeInstanceOf(DecryptionError);
  }, 120_000);
});
