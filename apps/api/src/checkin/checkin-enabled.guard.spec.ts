import { NotFoundException } from '@nestjs/common';
import { AppConfig } from '../config/env';
import { CheckInEnabledGuard } from './checkin-enabled.guard';

describe('CheckInEnabledGuard', () => {
  it('lets requests through when the feature is on', () => {
    expect(new CheckInEnabledGuard({ GUEST_CHECKIN_ENABLED: true } as AppConfig).canActivate()).toBe(true);
  });

  it('answers 404 as if the route did not exist when the feature is off', () => {
    const guard = new CheckInEnabledGuard({ GUEST_CHECKIN_ENABLED: false } as AppConfig);
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});
