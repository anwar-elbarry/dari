import { ObjectNotFoundError, ObjectStore } from './object-store';

/** Development and test store. Refused in production by env validation. Nothing survives a restart. */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer) {
    this.objects.set(key, Buffer.from(body));
  }
  async get(key: string) {
    const body = this.objects.get(key);
    if (!body) throw new ObjectNotFoundError();
    return Buffer.from(body);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }

  /** Test helpers: what an attacker with the bucket would see. */
  keys() {
    return [...this.objects.keys()];
  }
  raw(key: string) {
    return this.objects.get(key);
  }
}
