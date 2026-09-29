import { Logger } from '@nestjs/common';
import { MailDriver, MailMessage } from './mail.types';

/**
 * Development driver: prints the message so reset and invitation links can be clicked locally.
 * Bodies contain single-use tokens, which is why env validation forbids this driver in production.
 */
export class ConsoleMailDriver implements MailDriver {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage & { from: string }): Promise<void> {
    this.logger.log(`\nFrom: ${message.from}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
  }
}
