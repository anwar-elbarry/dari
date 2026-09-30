import { NotFoundException } from '@nestjs/common';
import { AppConfig } from '../config/env';
import { PoliceRegisterEnabledGuard } from './police-register-enabled.guard';

describe('PoliceRegisterEnabledGuard', () => {
  it('lets requests through when the feature is on, whatever the check-in flag says', () => {
    expect(new PoliceRegisterEnabledGuard({ POLICE_REGISTER_ENABLED: true, GUEST_CHECKIN_ENABLED: false } as AppConfig).canActivate()).toBe(true);
  });
  it('answers 404 when the feature is off, even with check-in on', () => {
    expect(() => new PoliceRegisterEnabledGuard({ POLICE_REGISTER_ENABLED: false, GUEST_CHECKIN_ENABLED: true } as AppConfig).canActivate()).toThrow(NotFoundException);
  });
});
