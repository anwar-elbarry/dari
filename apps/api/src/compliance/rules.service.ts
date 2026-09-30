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
export const ID_RETENTION_RULE_KEY = 'retention.id_images_days';
export const CHECKIN_GRACE_RULE_KEY = 'checkin.link_grace_hours';
export const FICHE_RETENTION_RULE_KEY = 'retention.fiche_days';
export const REGISTER_RETENTION_RULE_KEY = 'retention.police_register_days';

export interface IdRetentionRule {
  /** Days after checkout before ID images and extraction artefacts are deleted. */
  days: number;
  validated: boolean;
}
/** No default exists for these: until counsel sets a period, `days` is null and nothing is deleted. */
export interface RecordRetentionRule {
  /** Days after the end of the stay (Fiche) or of the month (register) before the PDF is deleted; null = not set. */
  days: number | null;
  validated: boolean;
  /** The period to apply: only a valid number that counsel has validated. Deleting is irreversible, so a guess is never applied. */
  enforceable: number | null;
}
export interface CheckinGraceRule {
  /** Hours after the booked checkout during which a check-in link still works. */
  hours: number;
  validated: boolean;
}

/** Fallbacks when the row is missing or malformed: the plan's defaults, reported as not validated. */
export const DEFAULT_ID_RETENTION_DAYS = 30;
export const DEFAULT_CHECKIN_GRACE_HOURS = 48;

/** Ten years: an upper bound that catches a typo, not a legal position. */
export const MAX_RECORD_RETENTION_DAYS = 3650;

/** Accepts a whole number in [min, max] and nothing else. Exported for tests. */
export function boundedInt(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

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

  async idRetention(): Promise<IdRetentionRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: ID_RETENTION_RULE_KEY } });
    const days = boundedInt((row?.value as { days?: unknown } | null)?.days, 1, 365);
    if (!row || days === null) {
      this.logger.error(`RuleConfig "${ID_RETENTION_RULE_KEY}" missing or invalid; using ${DEFAULT_ID_RETENTION_DAYS} days`);
      return { days: DEFAULT_ID_RETENTION_DAYS, validated: false };
    }
    return { days, validated: !!row.validatedBy };
  }

  async checkinGrace(): Promise<CheckinGraceRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: CHECKIN_GRACE_RULE_KEY } });
    const hours = boundedInt((row?.value as { hours?: unknown } | null)?.hours, 0, 720);
    if (!row || hours === null) {
      this.logger.error(`RuleConfig "${CHECKIN_GRACE_RULE_KEY}" missing or invalid; using ${DEFAULT_CHECKIN_GRACE_HOURS} hours`);
      return { hours: DEFAULT_CHECKIN_GRACE_HOURS, validated: false };
    }
    return { hours, validated: !!row.validatedBy };
  }

  async ficheRetention(): Promise<RecordRetentionRule> {
    return this.recordRetention(FICHE_RETENTION_RULE_KEY);
  }

  async policeRegisterRetention(): Promise<RecordRetentionRule> {
    return this.recordRetention(REGISTER_RETENTION_RULE_KEY);
  }

  private async recordRetention(key: string): Promise<RecordRetentionRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key } });
    const days = boundedInt((row?.value as { days?: unknown } | null)?.days, 1, MAX_RECORD_RETENTION_DAYS);
    const validated = !!row?.validatedBy;
    return { days, validated, enforceable: days !== null && validated ? days : null };
  }
}
