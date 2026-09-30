import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PropertyEventsModule } from './common/property-events';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { JobsModule } from './jobs/jobs.module';
import { REDIS, RedisClient, RedisModule } from './redis/redis.module';
import { AlertsModule } from './alerts/alerts.module';
import { RetentionModule } from './retention/retention.module';
import { CheckInModule } from './checkin/checkin.module';
import { RegisterModule } from './register/register.module';
import { TaxModule } from './tax/tax.module';
import { ShareModule } from './share/share.module';
import { StorageModule } from './storage/storage.module';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './common/csrf.guard';
import { ComplianceModule } from './compliance/compliance.module';
import { ConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig, parseEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { IcalModule } from './ical/ical.module';
import { ImportsModule } from './imports/imports.module';
import { InvitationsModule } from './invitations/invitations.module';
import { ChecklistModule } from './checklist/checklist.module';
import { MailModule } from './mail/mail.module';
import { CapabilitiesGuard } from './rbac/capabilities.guard';
import { PrismaModule } from './prisma/prisma.module';
import { PropertiesModule } from './properties/properties.module';

@Module({})
export class AppModule {
  /** `config` is passed by tests; production boots from validated `process.env`. */
  static register(config?: AppConfig): DynamicModule {
    const resolved = config ?? parseEnv(process.env);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(resolved),
        RedisModule,
        PropertyEventsModule,
        JobsModule.register(resolved),
        // Default limit for every route; sensitive routes set stricter limits with @Throttle().
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG, REDIS],
          useFactory: (c: AppConfig, redis: RedisClient) => ({
            throttlers: [{ ttl: c.THROTTLE_TTL_MS, limit: c.THROTTLE_LIMIT }],
            skipIf: () => !c.RATE_LIMIT_ENABLED,
            ...(redis ? { storage: new RedisThrottlerStorage(redis) } : {}),
          }),
        }),
        PrismaModule,
        MailModule,
        AuditModule,
        StorageModule,
        CheckInModule,
        RegisterModule,
        TaxModule,
        ShareModule,
        RetentionModule.register(resolved),
        AuthModule,
        InvitationsModule,
        ChecklistModule,
        PropertiesModule,
        IcalModule.register(resolved),
        ComplianceModule,
        ImportsModule,
        AlertsModule.register(resolved),
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
