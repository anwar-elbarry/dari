import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_RETENTION } from '../jobs/jobs.module';
import { StorageService } from '../storage/storage.service';
import { RetentionService } from './retention.service';

export const JOB_PURGE = 'purge';
export const JOB_REWRAP = 'rewrap';
const REWRAP_BATCHES = 10; // 10 x 200 objects per run; a big backlog simply takes a few runs

/**
 * Two hourly jobs. `purge` deletes what must not be kept; `rewrap` moves every stored object's data key to the current
 * master key after a rotation (objects are not touched), so an old master key can be retired once nothing uses it.
 * Runs the purge every hour (Redis only; production requires Redis). The job FAILS when anything could not be
 * purged, so the failure is visible in the queue and BullMQ retries it with backoff; the service has already
 * logged and, when OPS_ALERT_EMAIL is set, emailed.
 */
@Injectable()
@Processor(QUEUE_RETENTION, { concurrency: 1 })
export class RetentionProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_RETENTION) private readonly queue: Queue,
    private readonly retention: RetentionService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(JOB_PURGE, { every: 3_600_000 }, { name: JOB_PURGE, data: {} });
    await this.queue.upsertJobScheduler(JOB_REWRAP, { every: 3_600_000 }, { name: JOB_REWRAP, data: {} });
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === JOB_REWRAP) {
      let rewrapped = 0;
      for (let i = 0; i < REWRAP_BATCHES; i++) {
        const n = await this.storage.rewrapOutdatedKeys(200);
        rewrapped += n;
        if (n === 0) break;
      }
      return { rewrapped };
    }
    if (job.name !== JOB_PURGE) return null;
    const result = await this.retention.purge();
    if (result.failed > 0) throw new Error(`Retention purge failed for ${result.failed} object(s)`);
    return result;
  }
}
