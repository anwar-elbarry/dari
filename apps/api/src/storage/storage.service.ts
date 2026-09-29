import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { StoredObjectKind } from '@prisma/client';
import { AuditAction, AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { Keyring, open, rewrapKey, seal, wrappedKeyId } from './envelope';
import { OBJECT_STORE, ObjectNotFoundError, ObjectStore } from './object-store';

export const KEYRING = Symbol('KEYRING');

/**
 * Who did what to which record, written to the audit trail. Required on every read and delete, so a
 * caller cannot forget: `resourceType`/`resourceId` name the business record (the guest, the fiche),
 * never the object key. Identifiers only.
 */
export interface StorageAudit {
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  ip?: string | null;
}

export interface StoredObjectInfo {
  id: string;
  kind: StoredObjectKind;
  sizeBytes: number;
  sha256: string;
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

/**
 * Encrypted private storage for ID images and Fiche PDFs.
 * - put: encrypt with a fresh data key, write ciphertext, then record the row (a failed row removes the object).
 * - read: decrypt in memory, write the audit row, only then return the bytes (audit failure = no bytes).
 * - delete: shred the wrapped key first (the object is unreadable from that moment), then remove the object.
 * There is no URL-returning method anywhere: bytes leave only through `read`, to an authenticated API route.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(KEYRING) private readonly keyring: Keyring,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private aad(accountId: string, key: string) {
    return `${accountId}/${key}`;
  }

  async put(accountId: string, kind: StoredObjectKind, plaintext: Buffer, opts: { expiresAt?: Date } = {}): Promise<StoredObjectInfo> {
    if (plaintext.length === 0 || plaintext.length > this.config.STORAGE_MAX_BYTES) {
      throw new InternalServerErrorException({ code: 'STORAGE_SIZE', message: 'Object size is not acceptable.' });
    }
    const key = `${accountId}/${kind.toLowerCase()}/${randomUUID()}`;
    const { ciphertext, wrappedKey } = seal(plaintext, this.keyring, this.aad(accountId, key));
    const sha256 = createHash('sha256').update(plaintext).digest('hex');

    await this.store.put(key, ciphertext);
    try {
      const row = await this.prisma.forAccount(accountId).storedObject.create({
        data: { accountId, key, kind, sizeBytes: plaintext.length, sha256, wrappedKey, expiresAt: opts.expiresAt ?? null },
      });
      return { id: row.id, kind, sizeBytes: row.sizeBytes, sha256 };
    } catch (e) {
      await this.store.delete(key).catch(() => undefined); // no orphan ciphertext without a row
      throw e;
    }
  }

  async read(accountId: string, id: string, audit: StorageAudit): Promise<{ bytes: Buffer } & StoredObjectInfo> {
    const row = await this.prisma.forAccount(accountId).storedObject.findFirst({ where: { id, deletedAt: null, NOT: { wrappedKey: '' } } });
    if (!row) throw notFound();

    let ciphertext: Buffer;
    try {
      ciphertext = await this.store.get(row.key);
    } catch (e) {
      if (e instanceof ObjectNotFoundError) throw notFound();
      throw e;
    }
    const bytes = open(ciphertext, row.wrappedKey, this.keyring, this.aad(accountId, row.key));

    // Fail closed: the read counts only once it is on record.
    await this.audit.record({ accountId, ...audit });
    return { bytes, id: row.id, kind: row.kind, sizeBytes: row.sizeBytes, sha256: row.sha256 };
  }

  /** Idempotent. Returns false when the object was already gone or belongs to another account. */
  async delete(accountId: string, id: string, audit: StorageAudit): Promise<boolean> {
    const db = this.prisma.forAccount(accountId);
    const row = await db.storedObject.findFirst({ where: { id, deletedAt: null } });
    if (!row) return false;

    // 1. Crypto-shred: from here the object cannot be decrypted, even if the next step fails or a copy survives in a backup.
    if (row.wrappedKey !== '') await db.storedObject.update({ where: { id }, data: { wrappedKey: '' } });
    // 2. Physical delete. If it fails the row stays (shredded, not deleted) and a retry finishes the job.
    await this.store.delete(row.key);
    await db.storedObject.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ accountId, ...audit });
    return true;
  }

  /**
   * Master-key rotation: wrap every live object's data key under the current master key. Objects are not
   * touched. Returns how many rows were rewrapped; call until it returns 0, then retire the old key.
   */
  async rewrapOutdatedKeys(limit = 200): Promise<number> {
    const rows = await this.prisma.storedObject.findMany({
      where: { deletedAt: null, NOT: [{ wrappedKey: '' }, { wrappedKey: { startsWith: `${this.keyring.currentId}:` } }] },
      take: limit,
    });
    for (const row of rows) {
      const wrappedKey = rewrapKey(row.wrappedKey, this.keyring, this.aad(row.accountId, row.key));
      await this.prisma.storedObject.update({ where: { id: row.id }, data: { wrappedKey } });
    }
    return rows.length;
  }

  /** For tests and diagnostics: which master key wraps an object. */
  async keyIdOf(accountId: string, id: string): Promise<string | null> {
    const row = await this.prisma.forAccount(accountId).storedObject.findFirst({ where: { id } });
    return row && row.wrappedKey ? wrappedKeyId(row.wrappedKey) : null;
  }
}
