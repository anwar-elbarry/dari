import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Feature flag TAX_REPORTS_ENABLED. When off, every tax report route answers as if it did not exist (404).
 * Put it on the controller with @UseGuards(TaxReportsEnabledGuard); never branch on the flag elsewhere.
 */
@Injectable()
export class TaxReportsEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.TAX_REPORTS_ENABLED) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    return true;
  }
}
