import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MailDriver, MailMessage } from './mail.types';

/**
 * Test driver: writes each message as JSON to MAIL_FILE_DIR so end-to-end tests can read links.
 * Refused in production by env validation (it stores single-use tokens on disk).
 */
export class FileMailDriver implements MailDriver {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async send(message: MailMessage & { from: string }): Promise<void> {
    const name = `${Date.now()}-${randomUUID()}.json`;
    writeFileSync(join(this.dir, name), JSON.stringify(message, null, 2));
  }
}
