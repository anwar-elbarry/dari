import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ConsoleMailDriver } from './console.driver';
import { FileMailDriver } from './file.driver';
import { MailService } from './mail.service';
import { MAIL_DRIVER, MailDriver } from './mail.types';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_DRIVER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MailDriver => {
        switch (config.MAIL_DRIVER) {
          case 'console':
            return new ConsoleMailDriver();
          case 'file':
            return new FileMailDriver(config.MAIL_FILE_DIR);
        }
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
