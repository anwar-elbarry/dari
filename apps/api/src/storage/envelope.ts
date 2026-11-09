import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Application-level envelope encryption for stored ID files (Phase 3, step 3.1).
 *
 * Each object gets its own random 256-bit data key (DEK). The DEK encrypts the bytes with AES-256-GCM and is
 * itself wrapped (AES-256-GCM) by a master key (KEK) that comes from the secret store, never from the repo.
 * Only the wrapped DEK is persisted next to the object, so a leaked bucket or backup yields ciphertext.
 *
 * Pure functions: no I/O, no environment access. Identifiers (object key) are bound as additional
 * authenticated data, so ciphertext moved to another object key fails to decrypt.
 */

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export interface SealedObject {
  /** iv(12) | tag(16) | ciphertext */
  ciphertext: Buffer;
  /** version(1) | iv(12) | tag(16) | wrapped DEK(32); store in `StoredObject.wrappedKey` */
  wrappedKey: Buffer;
  /** SHA-256 of the plaintext, hex; for integrity checks and the audit trail */
  sha256: string;
}

export function parseMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('storage master key must be 32 bytes (base64)');
  return key;
}

function aesEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function aesDecrypt(key: Buffer, blob: Buffer, aad: Buffer): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES) throw new Error('corrupt ciphertext');
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    // Wrong key, tampering or wrong object key: same neutral error, no detail.
    throw new Error('decryption failed');
  }
}

export function seal(masterKey: Buffer, objectKey: string, plaintext: Buffer): SealedObject {
  const dek = randomBytes(KEY_BYTES);
  const aad = Buffer.from(objectKey, 'utf8');
  const ciphertext = aesEncrypt(dek, plaintext, aad);
  const wrapped = aesEncrypt(masterKey, dek, aad);
  dek.fill(0);
  return {
    ciphertext,
    wrappedKey: Buffer.concat([Buffer.from([VERSION]), wrapped]),
    sha256: createHash('sha256').update(plaintext).digest('hex'),
  };
}

export function open(masterKey: Buffer, objectKey: string, ciphertext: Buffer, wrappedKey: Buffer): Buffer {
  if (wrappedKey[0] !== VERSION) throw new Error('unsupported key version');
  const aad = Buffer.from(objectKey, 'utf8');
  const dek = aesDecrypt(masterKey, wrappedKey.subarray(1), aad);
  try {
    return aesDecrypt(dek, ciphertext, aad);
  } finally {
    dek.fill(0);
  }
}

/** Re-wrap the data key under a new master key (rotation) without touching the stored ciphertext. */
export function rewrap(oldKey: Buffer, newKey: Buffer, objectKey: string, wrappedKey: Buffer): Buffer {
  if (wrappedKey[0] !== VERSION) throw new Error('unsupported key version');
  const aad = Buffer.from(objectKey, 'utf8');
  const dek = aesDecrypt(oldKey, wrappedKey.subarray(1), aad);
  const wrapped = aesEncrypt(newKey, dek, aad);
  dek.fill(0);
  return Buffer.concat([Buffer.from([VERSION]), wrapped]);
}
