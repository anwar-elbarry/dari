import { Module } from '@nestjs/common';
import { MemoryWindowCounter, RedisWindowCounter, WindowCounter } from '../common/window-counter';
import { ComplianceModule } from '../compliance/compliance.module';
import { MessagingModule } from '../messaging/messaging.module';
import { REDIS, RedisClient } from '../redis/redis.module';
import { CheckInEnabledGuard } from './checkin-enabled.guard';
import { ConsentService } from './consent.service';
import { FicheService } from './fiche.service';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { OcrClient } from './ocr.client';
import { PdfRenderer } from './pdf-renderer';
import { PublicCheckInController } from './public.controller';
import { PublicCheckInService, WINDOW_COUNTER } from './public.service';

/** Guest check-in (Phase 3): links, the public guest flow, and the team's guest views. Fiche PDF arrives in 3.5. */
@Module({
  imports: [ComplianceModule, MessagingModule],
  controllers: [LinksController, PublicCheckInController, GuestsController],
  providers: [
    {
      provide: WINDOW_COUNTER,
      inject: [REDIS],
      useFactory: (redis: RedisClient): WindowCounter => (redis ? new RedisWindowCounter(redis) : new MemoryWindowCounter()),
    },
    ConsentService,
    CheckInEnabledGuard,
    OcrClient,
    PdfRenderer,
    FicheService,
    LinksService,
    PublicCheckInService,
    GuestsService,
  ],
  exports: [ConsentService, CheckInEnabledGuard, PdfRenderer],
})
export class CheckInModule {}
