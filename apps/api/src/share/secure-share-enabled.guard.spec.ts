import { NotFoundException } from '@nestjs/common';
import { AppConfig } from '../config/env';
import { SecureShareEnabledGuard } from './secure-share-enabled.guard';

describe('SecureShareEnabledGuard', () => {
  it('lets requests through when the feature is on', () => {
    expect(new SecureShareEnabledGuard({ SECURE_SHARE_ENABLED: true } as AppConfig).canActivate()).toBe(true);
  });
  it('answers 404 when the feature is off, whatever the other flags say', () => {
    expect(() => new SecureShareEnabledGuard({ SECURE_SHARE_ENABLED: false, POLICE_REGISTER_ENABLED: true, GUEST_CHECKIN_ENABLED: true } as AppConfig).canActivate()).toThrow(NotFoundException);
  });
});
