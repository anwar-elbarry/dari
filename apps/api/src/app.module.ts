import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './common/csrf.guard';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/env';
import { HealthController } from './health/health.controller';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { CapabilitiesGuard } from './rbac/capabilities.guard';
import { PrismaModule } from './prisma/prisma.module';
import { PropertiesModule } from './properties/properties.module';

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
          useFactory: (c: AppConfig) => ({
            throttlers: [{ ttl: c.THROTTLE_TTL_MS, limit: c.THROTTLE_LIMIT }],
            skipIf: () => !c.RATE_LIMIT_ENABLED,
          }),
        }),
        PrismaModule,
        MailModule,
        AuditModule,
        AuthModule,
        InvitationsModule,
        PropertiesModule,
      ],
      controllers: [HealthController],
      // Order matters: rate limit, then CSRF header, then session, then capabilities.
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: CapabilitiesGuard },
      ],
    };
  }
}
