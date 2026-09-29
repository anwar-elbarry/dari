import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppConfig } from '../config/env';

/** Queue names. Payloads carry ids only: never URLs, tokens or personal data. */
export const QUEUE_SYNC = 'ical-sync';
export const QUEUE_ALERTS = 'alerts';
export const QUEUES = [QUEUE_SYNC, QUEUE_ALERTS] as const;

/**
 * BullMQ on Redis. Without REDIS_URL (development/test) no queue is registered; features that
 * enqueue work must inject the queue as optional and run inline or skip.
 */
@Module({})
export class JobsModule {
  static register(config: AppConfig): DynamicModule {
    if (!config.REDIS_URL) return { module: JobsModule };
    const url = new URL(config.REDIS_URL);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    };
    return {
      module: JobsModule,
      imports: [
        BullModule.forRoot({
          connection,
          prefix: 'dari',
          defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 500, removeOnFail: 1000 },
        }),
        ...QUEUES.map((name) => BullModule.registerQueue({ name })),
      ],
      exports: [BullModule],
    };
  }
}
