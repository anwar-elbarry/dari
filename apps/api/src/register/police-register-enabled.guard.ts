import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Feature flag POLICE_REGISTER_ENABLED. When off, every police register route answers as if it did not exist
 * (404), so a production deployment that has not closed the legal gates exposes nothing. Put it on the
 * controller with @UseGuards(PoliceRegisterEnabledGuard); it also applies to the public token routes.
 */
@Injectable()
export class PoliceRegisterEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.POLICE_REGISTER_ENABLED) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    return true;
  }
}
