import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE_ALERTS } from '../jobs/jobs.module';
import { logJobError, scheduleInBackground } from '../jobs/schedule';
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

  onModuleInit() {
    this.queue.on('error', (e) => logJobError(QUEUE_ALERTS, e));
    void scheduleInBackground(JOB_EVALUATE_ALL, () => this.queue.upsertJobScheduler(JOB_EVALUATE_ALL, { every: 3_600_000 }, { name: JOB_EVALUATE_ALL, data: {} }));
  }

  @OnWorkerEvent('error')
  onWorkerError(e: Error) {
    logJobError(QUEUE_ALERTS, e);
  }

  async process(job: Job): Promise<unknown> {
    return job.name === JOB_EVALUATE_ALL ? { created: await this.alerts.evaluateAll() } : null;
  }
}
