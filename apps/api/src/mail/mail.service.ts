import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MAIL_DRIVER, MailDriver, MailMessage } from './mail.types';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_DRIVER) private readonly driver: MailDriver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  send(message: MailMessage): Promise<void> {
    return this.driver.send({ ...message, from: this.config.MAIL_FROM });
  }
}
