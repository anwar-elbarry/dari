import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_RETENTION } from '../jobs/jobs.module';
import { RetentionService } from './retention.service';

export const JOB_PURGE = 'purge';

/**
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
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(JOB_PURGE, { every: 3_600_000 }, { name: JOB_PURGE, data: {} });
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== JOB_PURGE) return null;
    const result = await this.retention.purge();
    if (result.failed > 0) throw new Error(`Retention purge failed for ${result.failed} object(s)`);
    return result;
  }
}
