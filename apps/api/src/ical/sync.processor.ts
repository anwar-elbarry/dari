import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/env';
import { QUEUE_SYNC } from '../jobs/jobs.module';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';

export const JOB_SYNC_ALL = 'sync-all';
export const JOB_SYNC_FEED = 'sync-feed';

/**
 * Job id for one feed in one sync interval. BullMQ rejects custom ids containing ':', and finished jobs are
 * kept (removeOnComplete), so a fixed id per feed would block every later run. One id per feed and interval
 * bucket also stops duplicate jobs if "sync-all" fires twice in the same interval.
 */
export function feedJobId(feedId: string, intervalMs: number, now = Date.now()): string {
  return `${JOB_SYNC_FEED}-${feedId}-${Math.floor(now / intervalMs)}`;
}

/**
 * Scheduled sync. A repeatable "sync-all" job fans out one "sync-feed" job per feed (ids only in
 * payloads). Registered only when Redis is configured (see JobsModule).
 */
@Injectable()
@Processor(QUEUE_SYNC, { concurrency: 4 })
export class SyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger('IcalSync');

  constructor(
    @InjectQueue(QUEUE_SYNC) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(JOB_SYNC_ALL, { every: this.config.ICAL_SYNC_INTERVAL_HOURS * 3_600_000 }, { name: JOB_SYNC_ALL, data: {} });
  }

  async process(job: Job<{ feedId?: string }>): Promise<unknown> {
    if (job.name === JOB_SYNC_ALL) {
      const feeds = await this.prisma.icalFeed.findMany({ select: { id: true } });
      const interval = this.config.ICAL_SYNC_INTERVAL_HOURS * 3_600_000;
      if (feeds.length) await this.queue.addBulk(feeds.map((f) => ({ name: JOB_SYNC_FEED, data: { feedId: f.id }, opts: { jobId: feedJobId(f.id, interval) } })));
      return { enqueued: feeds.length };
    }
    if (job.name === JOB_SYNC_FEED && job.data.feedId) {
      const result = await this.sync.syncFeed(job.data.feedId);
      if (!result.ok) this.logger.warn(`feed ${job.data.feedId}: ${result.error}`);
      return result;
    }
    return null;
  }
}
