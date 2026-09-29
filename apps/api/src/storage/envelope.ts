import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for stored objects.
 *
 * Each object gets its own random 256-bit data key and is encrypted with AES-256-GCM. The data key is
 * wrapped (encrypted, also AES-256-GCM) by a master key from the keyring and stored beside the object's
 * database row; the master keys never touch the database or the bucket. Consequences:
 * - a leaked bucket or backup is ciphertext only;
 * - rotating the master key only rewraps the small data keys (`rewrapKey`), not the objects;
 * - destroying the wrapped key makes an object unreadable everywhere, backups included.
 *
 * Both layers are bound to `aad` (account id + object key), so a ciphertext or wrapped key copied to
 * another row or account fails authentication.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export interface Keyring {
  /** Key id used for new wraps. */
  currentId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export class KeyringError extends Error {}
export class DecryptionError extends Error {
  constructor() {
    // One fixed message: no detail about which layer failed or why.
    super('Object could not be decrypted');
  }
}

/**
 * Parses `id:base64key,id:base64key`. The first entry is the current key; later entries are kept only so
 * objects wrapped under them can still be opened until they are rewrapped. Errors name the position,
 * never the value.
 */
export function parseKeyring(spec: string): Keyring {
  const entries = spec.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) throw new KeyringError('no keys configured');
  const keys = new Map<string, Buffer>();
  entries.forEach((entry, i) => {
    const sep = entry.indexOf(':');
    const id = sep > 0 ? entry.slice(0, sep) : '';
    const b64 = sep > 0 ? entry.slice(sep + 1) : '';
    if (!/^[a-z0-9_-]{1,16}$/.test(id)) throw new KeyringError(`key ${i + 1}: id must be 1-16 characters of a-z, 0-9, _ or -`);
    // 32 bytes = 43 base64 characters plus one `=` of padding (openssl rand -base64 32).
    if (!/^[A-Za-z0-9+/]{43}=$/.test(b64)) {
      throw new KeyringError(`key ${i + 1}: must be ${KEY_BYTES} random bytes, base64-encoded (openssl rand -base64 32)`);
    }
    const key = Buffer.from(b64, 'base64');
    if (keys.has(id)) throw new KeyringError(`key ${i + 1}: duplicate id`);
    keys.set(id, key);
  });
  return { currentId: entries[0].slice(0, entries[0].indexOf(':')), keys };
}

export interface Sealed {
  /** version | iv | ciphertext | tag — what goes into the bucket. */
  ciphertext: Buffer;
  /** `keyId:base64(iv | wrapped data key | tag)` — what goes into the database row. */
  wrappedKey: string;
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

function decrypt(key: Buffer, packed: Buffer, aad: Buffer): Buffer {
  if (packed.length < IV_BYTES + TAG_BYTES) throw new DecryptionError();
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(packed.length - TAG_BYTES);
  const body = packed.subarray(IV_BYTES, packed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

/** Domain-separated so a wrap can never be mistaken for an object body and vice versa. */
const aadFor = (purpose: 'object' | 'wrap', aad: string) => Buffer.from(`dari:${purpose}:v${VERSION}:${aad}`);

export function seal(plaintext: Buffer, keyring: Keyring, aad: string): Sealed {
  const dataKey = randomBytes(KEY_BYTES);
  try {
    const body = encrypt(dataKey, plaintext, aadFor('object', aad));
    const wrapped = encrypt(keyring.keys.get(keyring.currentId)!, dataKey, aadFor('wrap', aad));
    return { ciphertext: Buffer.concat([Buffer.from([VERSION]), body]), wrappedKey: `${keyring.currentId}:${wrapped.toString('base64')}` };
  } finally {
    dataKey.fill(0);
  }
}

function unwrap(wrappedKey: string, keyring: Keyring, aad: string): Buffer {
  const sep = wrappedKey.indexOf(':');
  const master = sep > 0 ? keyring.keys.get(wrappedKey.slice(0, sep)) : undefined;
  if (!master) throw new DecryptionError(); // blank (shredded), unknown key id or malformed
  return decrypt(master, Buffer.from(wrappedKey.slice(sep + 1), 'base64'), aadFor('wrap', aad));
}

export function open(ciphertext: Buffer, wrappedKey: string, keyring: Keyring, aad: string): Buffer {
  if (ciphertext.length < 1 || ciphertext[0] !== VERSION) throw new DecryptionError();
  const dataKey = unwrap(wrappedKey, keyring, aad);
  try {
    return decrypt(dataKey, ciphertext.subarray(1), aadFor('object', aad));
  } finally {
    dataKey.fill(0);
  }
}

/** Key rotation: wraps the same data key under the current master key. The object itself is untouched. */
export function rewrapKey(wrappedKey: string, keyring: Keyring, aad: string): string {
  const dataKey = unwrap(wrappedKey, keyring, aad);
  try {
    return `${keyring.currentId}:${encrypt(keyring.keys.get(keyring.currentId)!, dataKey, aadFor('wrap', aad)).toString('base64')}`;
  } finally {
    dataKey.fill(0);
  }
}

export function wrappedKeyId(wrappedKey: string): string {
  return wrappedKey.slice(0, Math.max(0, wrappedKey.indexOf(':')));
}
