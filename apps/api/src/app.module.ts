import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  /** `config` is passed by tests; production boots from validated `process.env`. */
  static register(config?: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        // Default limit for every route; auth routes get stricter limits in step 1.2.
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => [{ ttl: c.THROTTLE_TTL_MS, limit: c.THROTTLE_LIMIT }],
        }),
        PrismaModule,
        MailModule,
        AuditModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    };
  }
}
