import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from '../config/env';
import { QUEUE_SYNC } from '../jobs/jobs.module';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';

@Module({})
export class IcalModule {
  /** The scheduled processor needs the queue, which exists only with Redis. */
  static register(config: AppConfig): DynamicModule {
    return {
      module: IcalModule,
      imports: config.REDIS_URL ? [BullModule.registerQueue({ name: QUEUE_SYNC })] : [],
      controllers: [FeedsController],
      providers: [SyncService, FeedsService, ...(config.REDIS_URL ? [SyncProcessor] : [])],
      exports: [SyncService],
    };
  }
}
