import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DayCounterThresholds, DEFAULT_THRESHOLDS } from './day-counter';

export interface DayCounterRule extends DayCounterThresholds {
  cap: number;
  period: 'CALENDAR_YEAR';
  /** False until counsel has confirmed the rule (RuleConfig.validatedBy). Shown to users. */
  validated: boolean;
}

export const DAY_COUNTER_RULE_KEY = 'day_counter.thresholds';

/** Reads legal parameters from RuleConfig (rule 1 in CLAUDE.md). Values are never hard-coded in features. */
@Injectable()
export class RulesService {
  private readonly logger = new Logger('Rules');

  constructor(private readonly prisma: PrismaService) {}

  async dayCounter(): Promise<DayCounterRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: DAY_COUNTER_RULE_KEY } });
    const v = (row?.value ?? {}) as Partial<{ amber: number; red: number; cap: number; period: string }>;
    const ok = [v.amber, v.red, v.cap].every((n) => typeof n === 'number' && n > 0) && v.amber! < v.red! && v.red! <= v.cap!;
    if (!row || !ok) {
      this.logger.error(`RuleConfig "${DAY_COUNTER_RULE_KEY}" missing or invalid; using seed defaults`);
      return { ...DEFAULT_THRESHOLDS, cap: 120, period: 'CALENDAR_YEAR', validated: false };
    }
    return { amber: v.amber!, red: v.red!, cap: v.cap!, period: 'CALENDAR_YEAR', validated: !!row.validatedBy };
  }
}
