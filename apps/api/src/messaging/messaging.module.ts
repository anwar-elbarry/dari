import { Module } from '@nestjs/common';
import { MemoryWindowCounter, RedisWindowCounter, WindowCounter } from '../common/window-counter';
import { ComplianceModule } from '../compliance/compliance.module';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MessagingController } from './messaging.controller';
import { REDIS, RedisClient } from '../redis/redis.module';
import { MESSAGING_COUNTER, MessagingService } from './messaging.service';
import { PreferencesService } from './preferences.service';
import { CloudWhatsAppProvider, StubWhatsAppProvider, WHATSAPP_PROVIDER, WhatsAppProvider } from './whatsapp.provider';
import { WhatsAppEnabledGuard } from './whatsapp-enabled.guard';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

/** WhatsApp delivery with e-mail as the fallback (Phase 6). Other modules import it and call `MessagingService.send()`. */
@Module({
  imports: [ComplianceModule],
  controllers: [MessagingController, WhatsAppWebhookController],
  providers: [
    MessagingService,
    PreferencesService,
    WhatsAppEnabledGuard,
    { provide: MESSAGING_COUNTER, inject: [REDIS], useFactory: (redis: RedisClient): WindowCounter => (redis ? new RedisWindowCounter(redis) : new MemoryWindowCounter()) },
    {
      provide: WHATSAPP_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): WhatsAppProvider =>
        c.WHATSAPP_DRIVER === 'cloud' ? new CloudWhatsAppProvider(c.WHATSAPP_PHONE_NUMBER_ID!, c.WHATSAPP_ACCESS_TOKEN!, c.WHATSAPP_API_VERSION) : new StubWhatsAppProvider(),
    },
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
