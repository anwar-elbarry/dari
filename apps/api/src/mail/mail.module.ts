import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ConsoleMailDriver } from './console.driver';
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
        }
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
