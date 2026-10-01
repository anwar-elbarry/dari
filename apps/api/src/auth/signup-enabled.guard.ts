import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/** Feature flag SIGNUP_ENABLED: when off, `POST /auth/signup` answers as if it did not exist (404). */
@Injectable()
export class SignupEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.SIGNUP_ENABLED) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    return true;
  }
}
