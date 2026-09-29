import { MailDriver, MailMessage } from './mail.types';

/**
 * Development driver: prints the message so reset and invitation links can be clicked locally.
 * Bodies contain single-use tokens, which is why env validation forbids this driver in production.
 * It writes to stdout directly: the application logger redacts emails and tokens, which would defeat the purpose.
 */
export class ConsoleMailDriver implements MailDriver {
  async send(message: MailMessage & { from: string }): Promise<void> {
    process.stdout.write(`\n[Mail]\nFrom: ${message.from}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n\n`);
  }
}
