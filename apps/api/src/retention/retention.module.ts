import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { AppConfig } from '../config/env';
import { QUEUE_RETENTION } from '../jobs/jobs.module';
import { RetentionProcessor } from './retention.processor';
import { RetentionService } from './retention.service';

/** Registered whatever the guest feature flag says: data that exists must still be purged on time. */
@Module({})
export class RetentionModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: RetentionModule,
      imports: [ComplianceModule, ...(config.REDIS_URL ? [BullModule.registerQueue({ name: QUEUE_RETENTION })] : [])],
      providers: [RetentionService, ...(config.REDIS_URL ? [RetentionProcessor] : [])],
      exports: [RetentionService],
    };
  }
}
