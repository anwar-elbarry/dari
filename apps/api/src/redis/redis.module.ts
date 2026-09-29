import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/env';

/** ioredis client, or null when REDIS_URL is not set (development/test fallbacks are then used). */
export const REDIS = Symbol('REDIS');
export type RedisClient = Redis | null;

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RedisClient => {
        if (!config.REDIS_URL) return null;
        const client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
        client.on('error', (e) => new Logger('Redis').error(e.message));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
