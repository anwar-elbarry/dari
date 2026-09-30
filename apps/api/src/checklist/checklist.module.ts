import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';

/** Licensing checklist (Phase 6). */
@Module({ controllers: [ChecklistController], providers: [ChecklistService] })
export class ChecklistModule {}
