import { randomBytes } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { createTestApp, requireDatabase, resetDatabase, TestApp } from '../test/test-app';
import { DecryptionError, Keyring, parseKeyring } from './envelope';
import { MemoryObjectStore } from './memory-object-store';
import { OBJECT_STORE } from './object-store';
import { StorageAudit, StorageService } from './storage.service';

requireDatabase();

const IMAGE = Buffer.from('SPECIMEN-ID-IMAGE-' + 'x'.repeat(2000));
const readAudit = (guestId: string): StorageAudit => ({ actorId: 'user-1', action: 'guest.document.read', resourceType: 'GuestCheckIn', resourceId: guestId, ip: '203.0.113.7' });
const deleteAudit = (guestId: string): StorageAudit => ({ actorId: null, action: 'storage.object.deleted', resourceType: 'GuestCheckIn', resourceId: guestId });

describe('StorageService (integration)', () => {
  let t: TestApp;
  let storage: StorageService;
  let store: MemoryObjectStore;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(StorageService);
    store = t.app.get<MemoryObjectStore>(OBJECT_STORE);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    a = (await t.prisma.account.create({ data: { companyName: 'A' } })).id;
    b = (await t.prisma.account.create({ data: { companyName: 'B' } })).id;
    for (const key of store.keys()) await store.delete(key);
  });

  it('stores ciphertext, never the plaintext, under a random key with no personal data in it', async () => {
    const info = await storage.put(a, 'ID_IMAGE', IMAGE);

    expect(store.keys()).toHaveLength(1);
    const [key] = store.keys();
    expect(key).toMatch(new RegExp(`^${a}/id_image/[0-9a-f-]{36}$`));
    expect(store.raw(key)!.includes(Buffer.from('SPECIMEN'))).toBe(false);

    const row = await t.prisma.storedObject.findUniqueOrThrow({ where: { id: info.id } });
    expect(row).toMatchObject({ accountId: a, kind: 'ID_IMAGE', sizeBytes: IMAGE.length, deletedAt: null });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.wrappedKey).toMatch(/^ephemeral:/);
  });

  it('returns the exact bytes on read and writes an audit row with identifiers only', async () => {
    const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);

    const read = await storage.read(a, id, readAudit('guest-1'));
    expect(read.bytes.equals(IMAGE)).toBe(true);

    const audit = await t.prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ accountId: a, actorId: 'user-1', action: 'guest.document.read', resourceType: 'GuestCheckIn', resourceId: 'guest-1', ip: '203.0.113.7' });
    expect(JSON.stringify(audit)).not.toContain(store.keys()[0]);
  });

  it('fails closed: if the audit row cannot be written, no bytes are returned', async () => {
    const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);
    const spy = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit down'));

    await expect(storage.read(a, id, readAudit('guest-1'))).rejects.toThrow('audit down');
    spy.mockRestore();
  });

  it('answers 404 for another account, an unknown id and a deleted object', async () => {
    const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);

    await expect(storage.read(b, id, readAudit('g'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(storage.read(a, '00000000-0000-4000-8000-000000000000', readAudit('g'))).rejects.toBeInstanceOf(NotFoundException);
    expect(await storage.delete(b, id, deleteAudit('g'))).toBe(false);
    expect(store.keys()).toHaveLength(1); // the other account could not delete it
    expect(await t.prisma.auditLog.count()).toBe(0);
  });

  it('refuses ciphertext that was swapped or altered in the bucket', async () => {
    const one = await storage.put(a, 'ID_IMAGE', IMAGE);
    const two = await storage.put(a, 'ID_IMAGE', Buffer.from('another image'));
    const keys = Object.fromEntries((await t.prisma.storedObject.findMany()).map((r) => [r.id, r.key]));

    // Swap: object two's bytes under object one's key.
    await store.put(keys[one.id], store.raw(keys[two.id])!);
    await expect(storage.read(a, one.id, readAudit('g'))).rejects.toBeInstanceOf(DecryptionError);

    // Flip a bit.
    const altered = Buffer.from(store.raw(keys[two.id])!);
    altered[altered.length - 1] ^= 1;
    await store.put(keys[two.id], altered);
    await expect(storage.read(a, two.id, readAudit('g'))).rejects.toBeInstanceOf(DecryptionError);
    expect(await t.prisma.auditLog.count()).toBe(0); // failed reads are not successful reads
  });

  it('a different master key cannot read objects (wrong key fails)', async () => {
    const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);
    const otherKeys = parseKeyring(`ephemeral:${randomBytes(32).toString('base64')}`);
    const other = new StorageService(t.prisma, t.app.get(AuditService), store, otherKeys, t.config);
    await expect(other.read(a, id, readAudit('g'))).rejects.toBeInstanceOf(DecryptionError);
  });

  describe('delete', () => {
    it('removes the object, blanks the wrapped key, marks the row and audits', async () => {
      const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);
      const key = store.keys()[0];

      expect(await storage.delete(a, id, deleteAudit('guest-1'))).toBe(true);

      expect(store.keys()).toHaveLength(0);
      const row = await t.prisma.storedObject.findUniqueOrThrow({ where: { id } });
      expect(row.wrappedKey).toBe('');
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.key).toBe(key); // the row is kept for the record; the data is gone
      expect((await t.prisma.auditLog.findMany()).map((r) => r.action)).toEqual(['storage.object.deleted']);
      await expect(storage.read(a, id, readAudit('g'))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is idempotent', async () => {
      const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);
      expect(await storage.delete(a, id, deleteAudit('g'))).toBe(true);
      expect(await storage.delete(a, id, deleteAudit('g'))).toBe(false);
      expect(await t.prisma.auditLog.count()).toBe(1);
    });

    it('shreds the key first: if the bucket delete fails the object is already unreadable, and a retry finishes', async () => {
      const { id } = await storage.put(a, 'ID_IMAGE', IMAGE);
      const spy = jest.spyOn(store, 'delete').mockRejectedValueOnce(new Error('bucket down'));

      await expect(storage.delete(a, id, deleteAudit('g'))).rejects.toThrow('bucket down');
      let row = await t.prisma.storedObject.findUniqueOrThrow({ where: { id } });
      expect(row.wrappedKey).toBe('');
      expect(row.deletedAt).toBeNull();
      await expect(storage.read(a, id, readAudit('g'))).rejects.toBeInstanceOf(NotFoundException);
      expect(store.keys()).toHaveLength(1); // ciphertext still there, but useless

      spy.mockRestore();
      expect(await storage.delete(a, id, deleteAudit('g'))).toBe(true);
      row = await t.prisma.storedObject.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(store.keys()).toHaveLength(0);
    });
  });

  describe('put', () => {
    it('refuses empty and oversized objects without storing anything', async () => {
      await expect(storage.put(a, 'ID_IMAGE', Buffer.alloc(0))).rejects.toMatchObject({ response: { code: 'STORAGE_SIZE' } });
      await expect(storage.put(a, 'ID_IMAGE', Buffer.alloc(t.config.STORAGE_MAX_BYTES + 1))).rejects.toMatchObject({ response: { code: 'STORAGE_SIZE' } });
      expect(store.keys()).toHaveLength(0);
    });

    it('leaves no orphan ciphertext when the row cannot be written', async () => {
      await expect(storage.put('no-such-account', 'ID_IMAGE', IMAGE)).rejects.toBeDefined();
      expect(store.keys()).toHaveLength(0);
    });

    it('records the retention date', async () => {
      const expiresAt = new Date('2026-12-01T00:00:00Z');
      const { id } = await storage.put(a, 'FICHE_PDF', IMAGE, { expiresAt });
      expect((await t.prisma.storedObject.findUniqueOrThrow({ where: { id } })).expiresAt).toEqual(expiresAt);
    });
  });

  describe('master key rotation', () => {
    it('rewraps data keys under the new key; objects stay readable and the old key can be retired', async () => {
      const k1 = randomBytes(32);
      const k2 = randomBytes(32);
      const ring1: Keyring = { currentId: 'k1', keys: new Map([['k1', k1]]) };
      const ring12: Keyring = { currentId: 'k2', keys: new Map([['k2', k2], ['k1', k1]]) };
      const ring2: Keyring = { currentId: 'k2', keys: new Map([['k2', k2]]) };
      const audit = t.app.get(AuditService);
      const before = new StorageService(t.prisma, audit, store, ring1, t.config);
      const rotating = new StorageService(t.prisma, audit, store, ring12, t.config);
      const after = new StorageService(t.prisma, audit, store, ring2, t.config);

      const objects = [await before.put(a, 'ID_IMAGE', IMAGE), await before.put(b, 'FICHE_PDF', Buffer.from('pdf'))];
      const deleted = await before.put(a, 'ID_IMAGE', IMAGE);
      await before.delete(a, deleted.id, deleteAudit('g'));

      expect(await rotating.rewrapOutdatedKeys()).toBe(2); // shredded rows are skipped
      expect(await rotating.rewrapOutdatedKeys()).toBe(0);
      expect(await rotating.keyIdOf(a, objects[0].id)).toBe('k2');

      expect((await after.read(a, objects[0].id, readAudit('g'))).bytes.equals(IMAGE)).toBe(true);
      expect((await after.read(b, objects[1].id, readAudit('g'))).bytes.toString()).toBe('pdf');
    });
  });
});
