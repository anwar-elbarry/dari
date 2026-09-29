import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_ALERTS } from '../jobs/jobs.module';
import { AlertsService } from './alerts.service';

export const JOB_EVALUATE_ALL = 'evaluate-all';

/** Safety net: once an hour re-check every unlicensed property (a night passing can cross a threshold). */
@Injectable()
@Processor(QUEUE_ALERTS, { concurrency: 1 })
export class AlertsProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_ALERTS) private readonly queue: Queue,
    private readonly alerts: AlertsService,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(JOB_EVALUATE_ALL, { every: 3_600_000 }, { name: JOB_EVALUATE_ALL, data: {} });
  }

  async process(job: Job): Promise<unknown> {
    return job.name === JOB_EVALUATE_ALL ? { created: await this.alerts.evaluateAll() } : null;
  }
}
