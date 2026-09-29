import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ObjectNotFoundError, ObjectStore } from './object-store';

export interface S3Options {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  /** Ask the provider for server-side encryption (SSE-S3). On top of, not instead of, envelope encryption. */
  serverSideEncryption: boolean;
  /** Largest ciphertext accepted on read (defence against an oversized object). */
  maxBytes: number;
}

/**
 * S3-compatible store (MinIO in development). The bucket must be private with no public policy; this class
 * never sets an ACL and never creates a presigned URL.
 * Errors are reduced to fixed messages: SDK errors can carry the bucket, key and endpoint.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(private readonly options: S3Options) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });
  }

  async put(key: string, body: Buffer) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/octet-stream',
          CacheControl: 'no-store',
          ...(this.options.serverSideEncryption ? { ServerSideEncryption: 'AES256' as const } : {}),
        }),
      );
    } catch {
      throw new Error('Object storage write failed');
    }
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      if ((res.ContentLength ?? 0) > this.options.maxBytes) throw new Error('too large');
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') throw new ObjectNotFoundError();
      throw new Error('Object storage read failed');
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
    } catch {
      throw new Error('Object storage delete failed');
    }
  }

  /** Development and test only: creates the bucket when it is missing. Production buckets are provisioned. */
  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
    }
  }

  destroy() {
    this.client.destroy();
  }
}
