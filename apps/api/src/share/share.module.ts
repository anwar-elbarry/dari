import { Module } from '@nestjs/common';
import { MemoryWindowCounter, RedisWindowCounter, WindowCounter } from '../common/window-counter';
import { ComplianceModule } from '../compliance/compliance.module';
import { REDIS, RedisClient } from '../redis/redis.module';
import { MessagingModule } from '../messaging/messaging.module';
import { RegisterModule } from '../register/register.module';
import { SecureShareEnabledGuard } from './secure-share-enabled.guard';
import { PublicShareController, SharesController } from './share.controller';
import { SHARE_COUNTER, ShareService } from './share.service';

/** Secure Share (Phase 4): time-limited links to one Fiche or one register. */
@Module({
  imports: [ComplianceModule, RegisterModule, MessagingModule],
  controllers: [SharesController, PublicShareController],
  providers: [
    { provide: SHARE_COUNTER, inject: [REDIS], useFactory: (redis: RedisClient): WindowCounter => (redis ? new RedisWindowCounter(redis) : new MemoryWindowCounter()) },
    ShareService,
    SecureShareEnabledGuard,
  ],
})
export class ShareModule {}
