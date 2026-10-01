import { Module } from '@nestjs/common';
import { MemoryWindowCounter, RedisWindowCounter, WindowCounter } from '../common/window-counter';
import { REDIS, RedisClient } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { InvitationsController } from './invitations.controller';
import { INVITE_PROBE_COUNTER, InvitationsService } from './invitations.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({ imports: [AuthModule, ComplianceModule], controllers: [InvitationsController, TeamController], providers: [InvitationsService, TeamService, { provide: INVITE_PROBE_COUNTER, inject: [REDIS], useFactory: (redis: RedisClient): WindowCounter => (redis ? new RedisWindowCounter(redis) : new MemoryWindowCounter()) }] })
export class InvitationsModule {}
