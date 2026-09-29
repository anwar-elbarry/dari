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
});
