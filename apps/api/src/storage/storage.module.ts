import { Global, Logger, Module } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { Keyring, parseKeyring } from './envelope';
import { MemoryObjectStore } from './memory-object-store';
import { OBJECT_STORE, ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';
import { KEYRING, StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: KEYRING,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Keyring => {
        if (config.STORAGE_MASTER_KEYS) return parseKeyring(config.STORAGE_MASTER_KEYS);
        // Env validation guarantees this only happens outside production with the memory driver.
        new Logger('Storage').warn('STORAGE_MASTER_KEYS is not set: using an ephemeral key, stored objects are unreadable after a restart');
        return parseKeyring(`ephemeral:${randomBytes(32).toString('base64')}`);
      },
    },
    {
      provide: OBJECT_STORE,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<ObjectStore> => {
        if (config.STORAGE_DRIVER === 'memory') return new MemoryObjectStore();
        const store = new S3ObjectStore({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          bucket: config.S3_BUCKET!,
          accessKey: config.S3_ACCESS_KEY!,
          secretKey: config.S3_SECRET_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          serverSideEncryption: config.S3_SSE,
          maxBytes: config.STORAGE_MAX_BYTES + 1024,
        });
        if (config.NODE_ENV !== 'production') {
          // Development convenience; a missing store must not stop the API from booting.
          await store.ensureBucket().catch(() => new Logger('Storage').warn('Could not reach or create the storage bucket'));
        }
        return store;
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
