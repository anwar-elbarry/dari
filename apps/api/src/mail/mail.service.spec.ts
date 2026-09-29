import { AppConfig } from '../config/env';
import { MailService } from './mail.service';
import { MailDriver } from './mail.types';

describe('MailService', () => {
  it('sends through the driver with the configured sender', async () => {
    const driver: MailDriver = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new MailService(driver, { MAIL_FROM: 'Dari <no-reply@dari.test>' } as AppConfig);

    await service.send({ to: 'a@b.test', subject: 'Hi', text: 'Body' });

    expect(driver.send).toHaveBeenCalledWith({ to: 'a@b.test', subject: 'Hi', text: 'Body', from: 'Dari <no-reply@dari.test>' });
  });

  it('keeps subject and recipient on one line (no header injection)', async () => {
    const driver: MailDriver = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new MailService(driver, { MAIL_FROM: 'Dari <no-reply@dari.test>' } as AppConfig);

    await service.send({ to: 'a@b.test\r\nBcc: evil@x.test', subject: 'Alert — Riad\r\nBcc: evil@x.test\u2028X', text: 'Body\nkept' });

    const sent = (driver.send as jest.Mock).mock.calls[0][0];
    expect(sent.subject).toBe('Alert — Riad Bcc: evil@x.test X');
    expect(sent.to).not.toMatch(/[\r\n]/);
    expect(sent.text).toBe('Body\nkept');
  });
});
