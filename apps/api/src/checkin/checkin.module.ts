import { Module } from '@nestjs/common';
import { CheckInEnabledGuard } from './checkin-enabled.guard';
import { ConsentService } from './consent.service';

/** Guest check-in (Phase 3). Grows in 3.4 (links, public flow) and 3.5 (Fiche). */
@Module({ providers: [ConsentService, CheckInEnabledGuard], exports: [ConsentService, CheckInEnabledGuard] })
export class CheckInModule {}
