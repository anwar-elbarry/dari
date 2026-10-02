import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/env';

/** ioredis client, or null when REDIS_URL is not set (development/test fallbacks are then used). */
export const REDIS = Symbol('REDIS');
export type RedisClient = Redis | null;

/**
 * A command that has no answer within this time fails. Without it, requests wait for Redis to come back (login hung
 * for more than 15 s in the Phase 7.4 drill): rate limits and the lockout live in Redis, so they fail closed, and fast.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 1_000;

/** The one client configuration (the Redis-down test uses it too). */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: true, lazyConnect: false, commandTimeout: REDIS_COMMAND_TIMEOUT_MS });
  client.on('error', (e) => new Logger('Redis').error(`connection error (${e.name})`));
  return client;
}

/** How long start-up waits for the first connection; the command timeout would otherwise count the connect itself. */
export const REDIS_STARTUP_WAIT_MS = 5_000;

/** Resolves when the client is ready, or after `ms` (Redis down at start-up: the API starts anyway, degraded). */
export function untilReady(client: Redis, ms = REDIS_STARTUP_WAIT_MS): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off('ready', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    client.once('ready', done);
  });
}

/** True when Redis is configured and not connected: unexpected errors then answer 503 and health reports it. */
export const redisDown = (redis: RedisClient) => !!redis && redis.status !== 'ready';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<RedisClient> => {
        if (!config.REDIS_URL) return null;
        const client = createRedisClient(config.REDIS_URL);
        await untilReady(client);
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
