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
    // Header fields must be one line: a property name with a line break must not add headers.
    // eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
    const oneLine = (v: string) => v.replace(/[\r\n\u2028\u2029\u0000-\u001f]+/g, ' ').trim();
    return this.driver.send({ ...message, to: oneLine(message.to), subject: oneLine(message.subject), from: this.config.MAIL_FROM });
  }
}
