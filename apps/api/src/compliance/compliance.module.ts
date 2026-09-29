import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { ComplianceController } from './compliance.controller';
import { RulesService } from './rules.service';

@Module({ controllers: [ComplianceController], providers: [RulesService, BookingsService], exports: [RulesService, BookingsService] })
export class ComplianceModule {}
