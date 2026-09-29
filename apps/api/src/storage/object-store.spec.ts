import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryObjectStore } from './memory-object-store';
import { ObjectNotFoundError, ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';

/** The same behaviour is required of every store. The S3 run needs a real endpoint (MinIO in CI). */
function contract(name: string, make: () => Promise<ObjectStore> | ObjectStore, describeFn: typeof describe = describe) {
  describeFn(`ObjectStore contract: ${name}`, () => {
    let store: ObjectStore;
    beforeAll(async () => {
      store = await make();
    });

    it('stores and returns the exact bytes', async () => {
      const key = `test/${randomUUID()}`;
      const body = Buffer.from([0, 1, 2, 255, 254, 128]);
      await store.put(key, body);
      expect((await store.get(key)).equals(body)).toBe(true);
    });

    it('overwrites, and reports a missing key with ObjectNotFoundError', async () => {
      const key = `test/${randomUUID()}`;
      await store.put(key, Buffer.from('one'));
      await store.put(key, Buffer.from('two'));
      expect((await store.get(key)).toString()).toBe('two');
      await expect(store.get(`test/${randomUUID()}`)).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it('deletes, idempotently', async () => {
      const key = `test/${randomUUID()}`;
      await store.put(key, Buffer.from('x'));
      await store.delete(key);
      await expect(store.get(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
      await expect(store.delete(key)).resolves.toBeUndefined();
    });
  });
}

contract('memory', () => new MemoryObjectStore());

const endpoint = process.env.TEST_S3_ENDPOINT;
contract(
  's3 (TEST_S3_ENDPOINT)',
  async () => {
    const store = new S3ObjectStore({
      endpoint,
      region: 'us-east-1',
      bucket: process.env.TEST_S3_BUCKET ?? 'dari-test',
      accessKey: process.env.TEST_S3_ACCESS_KEY ?? 'minio',
      secretKey: process.env.TEST_S3_SECRET_KEY ?? 'minio12345',
      forcePathStyle: true,
      serverSideEncryption: false,
      maxBytes: 1024 * 1024,
    });
    await store.ensureBucket();
    return store;
  },
  endpoint ? describe : describe.skip,
);

describe('no public or presigned URLs', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.int-spec.ts')) files.push(path);
    }
  };
  walk(join(__dirname, '..'));

  it('the application code never presigns, and never sets a public ACL', () => {
    const offenders = files.filter((f) => /getSignedUrl|s3-request-presigner|createPresignedPost|x-amz-signature|ACL:\s*['"]public/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the ObjectStore interface has no URL-returning method', () => {
    const iface = readFileSync(join(__dirname, 'object-store.ts'), 'utf8');
    expect(iface).not.toMatch(/\b\w*url\w*\s*\(/i);
  });
});
