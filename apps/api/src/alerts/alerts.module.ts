import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { AppConfig } from '../config/env';
import { MessagingModule } from '../messaging/messaging.module';
import { QUEUE_ALERTS } from '../jobs/jobs.module';
import { AlertsController } from './alerts.controller';
import { AlertsProcessor } from './alerts.processor';
import { AlertsService } from './alerts.service';
import { DashboardService } from './dashboard.service';

@Module({})
export class AlertsModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AlertsModule,
      imports: [ComplianceModule, MessagingModule, ...(config.REDIS_URL ? [BullModule.registerQueue({ name: QUEUE_ALERTS })] : [])],
      controllers: [AlertsController],
      providers: [AlertsService, DashboardService, ...(config.REDIS_URL ? [AlertsProcessor] : [])],
      exports: [AlertsService],
    };
  }
}
