import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Feature flag GUEST_CHECKIN_ENABLED. When off, every guest check-in route answers as if it did not exist
 * (404), so a production deployment that has not closed the legal gates exposes nothing. Put it on the
 * controller with @UseGuards(CheckInEnabledGuard); it also applies to the public token routes.
 */
@Injectable()
export class CheckInEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.GUEST_CHECKIN_ENABLED) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    return true;
  }
}
