import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Feature flag WHATSAPP_ENABLED. When off, every WhatsApp route (settings, the provider's webhook) answers as if
 * it did not exist (404), so a production deployment that has not closed the gates exposes nothing. Put it on the
 * controller with @UseGuards(WhatsAppEnabledGuard). It does not switch off e-mail, which is the fallback channel.
 */
@Injectable()
export class WhatsAppEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.WHATSAPP_ENABLED) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    return true;
  }
}
