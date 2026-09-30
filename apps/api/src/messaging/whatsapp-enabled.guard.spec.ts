import { NotFoundException } from '@nestjs/common';
import { AppConfig } from '../config/env';
import { WhatsAppEnabledGuard } from './whatsapp-enabled.guard';

describe('WhatsAppEnabledGuard', () => {
  it('lets requests through when the feature is on', () => {
    expect(new WhatsAppEnabledGuard({ WHATSAPP_ENABLED: true } as AppConfig).canActivate()).toBe(true);
  });
  it('answers 404 when the feature is off, whatever the other flags say', () => {
    expect(() => new WhatsAppEnabledGuard({ WHATSAPP_ENABLED: false, GUEST_CHECKIN_ENABLED: true, SECURE_SHARE_ENABLED: true } as AppConfig).canActivate()).toThrow(NotFoundException);
  });
});
