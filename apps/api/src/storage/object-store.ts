/**
 * Byte storage behind StorageService. It only ever sees ciphertext and opaque random keys.
 * There is deliberately no method that returns a URL: objects leave the system only through
 * StorageService.read, which decrypts, audits and is called from API routes that stream the bytes.
 */
export interface ObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  /** Throws ObjectNotFoundError when the key does not exist. */
  get(key: string): Promise<Buffer>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
  }
}

export const OBJECT_STORE = Symbol('OBJECT_STORE');
