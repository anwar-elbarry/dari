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
export const SHARE_MIN_HOURS_RULE_KEY = 'share.min_hours';
export const SHARE_MAX_HOURS_RULE_KEY = 'share.max_hours';
export const FICHE_RETENTION_RULE_KEY = 'retention.fiche_days';
export const REGISTER_RETENTION_RULE_KEY = 'retention.police_register_days';
export const LICENSE_DOCUMENT_RETENTION_RULE_KEY = 'retention.license_documents_days';
export const WHATSAPP_TEMPLATES_RULE_KEY = 'whatsapp.templates';
export const QUIET_HOURS_RULE_KEY = 'messaging.quiet_hours';
export const DAILY_CAP_RULE_KEY = 'messaging.daily_cap';
export const SEAT_LIMITS_RULE_KEY = 'plan.seat_limits';

export interface SeatPolicyRule {
  /** Seats per plan; a plan without a figure is absent (the account's own `seatLimit` applies). */
  limits: Partial<Record<'STARTER' | 'GROWTH' | 'CONCIERGERIE' | 'ENTERPRISE', number>>;
  /** Roles that use a seat. The Accountant is not listed by default: a read-only external reader. */
  countedRoles: ('OWNER_MANAGER' | 'STAFF' | 'ACCOUNTANT')[];
  validated: boolean;
}
const SEAT_TIERS = ['STARTER', 'GROWTH', 'CONCIERGERIE', 'ENTERPRISE'] as const;
const SEAT_ROLES = ['OWNER_MANAGER', 'STAFF', 'ACCOUNTANT'] as const;

/** The messages the app can send by WhatsApp. Each maps to a template approved by Meta. */
export const WHATSAPP_TEMPLATE_KINDS = ['checkin_link', 'day_counter_alert', 'share_link'] as const;
export type WhatsAppTemplateKind = (typeof WHATSAPP_TEMPLATE_KINDS)[number];
export interface WhatsAppTemplate {
  name: string;
  language: string;
}
export interface WhatsAppTemplatesRule {
  /** Only kinds with an approved template appear here; a missing kind means "send by e-mail". */
  templates: Partial<Record<WhatsAppTemplateKind, WhatsAppTemplate>>;
  validated: boolean;
}
export interface QuietHoursRule {
  /** Minutes after midnight, in `timezone`. The window may cross midnight (start > end). */
  startMinute: number;
  endMinute: number;
  timezone: string;
  validated: boolean;
}
export interface DailyCapRule {
  /** Messages per account per day, all channels. */
  messages: number;
  validated: boolean;
}
export const DEFAULT_QUIET_HOURS = { startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'Africa/Casablanca' } as const;
export const DEFAULT_DAILY_CAP = 200;
/** Meta template names: lower-case letters, digits and underscores. Languages: `fr`, `en`, `ar`, `fr_FR`... */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE = /^[a-z]{2}(_[A-Z]{2})?$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
export interface ShareLifetimeRule {
  /** Bounds, in hours, for the expiry a manager may choose on a Secure Share link. */
  minHours: number;
  maxHours: number;
  validated: boolean;
}
export interface CheckinGraceRule {
  /** Hours after the booked checkout during which a check-in link still works. */
  hours: number;
  validated: boolean;
}

/** Fallbacks when the row is missing or malformed: the plan's defaults, reported as not validated. */
export const DEFAULT_ID_RETENTION_DAYS = 30;
export const DEFAULT_CHECKIN_GRACE_HOURS = 48;
export const DEFAULT_SHARE_MIN_HOURS = 24;
export const DEFAULT_SHARE_MAX_HOURS = 72;
/** A share link never lives longer than this, whatever the row says: a typo in RuleConfig must not create a permanent link. */
export const SHARE_HARD_MAX_HOURS = 168;

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

  /** Both bounds must be valid and min <= max, otherwise both fall back to the plan's 24 and 72 hours, reported as not validated. */
  async shareLifetime(): Promise<ShareLifetimeRule> {
    const [min, max] = await Promise.all([
      this.prisma.ruleConfig.findUnique({ where: { key: SHARE_MIN_HOURS_RULE_KEY } }),
      this.prisma.ruleConfig.findUnique({ where: { key: SHARE_MAX_HOURS_RULE_KEY } }),
    ]);
    const minHours = boundedInt((min?.value as { hours?: unknown } | null)?.hours, 1, SHARE_HARD_MAX_HOURS);
    const maxHours = boundedInt((max?.value as { hours?: unknown } | null)?.hours, 1, SHARE_HARD_MAX_HOURS);
    if (!min || !max || minHours === null || maxHours === null || minHours > maxHours) {
      this.logger.error(`RuleConfig "${SHARE_MIN_HOURS_RULE_KEY}" / "${SHARE_MAX_HOURS_RULE_KEY}" missing or invalid; using ${DEFAULT_SHARE_MIN_HOURS} to ${DEFAULT_SHARE_MAX_HOURS} hours`);
      return { minHours: DEFAULT_SHARE_MIN_HOURS, maxHours: DEFAULT_SHARE_MAX_HOURS, validated: false };
    }
    return { minHours, maxHours, validated: !!min.validatedBy && !!max.validatedBy };
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

  async licenseDocumentRetention(): Promise<RecordRetentionRule> {
    return this.recordRetention(LICENSE_DOCUMENT_RETENTION_RULE_KEY);
  }

  /** Templates whose name and language are both well formed. An empty or malformed entry is dropped, so that kind goes by e-mail. */
  async whatsappTemplates(): Promise<WhatsAppTemplatesRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: WHATSAPP_TEMPLATES_RULE_KEY } });
    const value = (row?.value ?? {}) as Record<string, { name?: unknown; language?: unknown } | null>;
    const templates: WhatsAppTemplatesRule['templates'] = {};
    for (const kind of WHATSAPP_TEMPLATE_KINDS) {
      const { name, language } = value[kind] ?? {};
      if (typeof name === 'string' && TEMPLATE_NAME.test(name) && typeof language === 'string' && TEMPLATE_LANGUAGE.test(language)) templates[kind] = { name, language };
    }
    return { templates, validated: !!row?.validatedBy };
  }

  /** A missing or malformed window falls back to the plan's 22:00 to 07:00 Africa/Casablanca, reported as not validated. */
  async quietHours(): Promise<QuietHoursRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: QUIET_HOURS_RULE_KEY } });
    const v = (row?.value ?? {}) as { start?: unknown; end?: unknown; timezone?: unknown };
    const start = typeof v.start === 'string' ? CLOCK.exec(v.start) : null;
    const end = typeof v.end === 'string' ? CLOCK.exec(v.end) : null;
    const zone = typeof v.timezone === 'string' && isTimeZone(v.timezone) ? v.timezone : null;
    if (!row || !start || !end || !zone) {
      this.logger.error(`RuleConfig "${QUIET_HOURS_RULE_KEY}" missing or invalid; using 22:00 to 07:00 ${DEFAULT_QUIET_HOURS.timezone}`);
      return { ...DEFAULT_QUIET_HOURS, validated: false };
    }
    return { startMinute: Number(start[1]) * 60 + Number(start[2]), endMinute: Number(end[1]) * 60 + Number(end[2]), timezone: zone, validated: !!row.validatedBy };
  }

  async dailyCap(): Promise<DailyCapRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: DAILY_CAP_RULE_KEY } });
    const messages = boundedInt((row?.value as { messages?: unknown } | null)?.messages, 1, 100_000);
    if (!row || messages === null) {
      this.logger.error(`RuleConfig "${DAILY_CAP_RULE_KEY}" missing or invalid; using ${DEFAULT_DAILY_CAP} messages a day`);
      return { messages: DEFAULT_DAILY_CAP, validated: false };
    }
    return { messages, validated: !!row.validatedBy };
  }

  /** Malformed figures are dropped; a malformed role list falls back to Owner/Manager and Staff (the Accountant never uses a seat by mistake). */
  async seatPolicy(): Promise<SeatPolicyRule> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key: SEAT_LIMITS_RULE_KEY } });
    const v = (row?.value ?? {}) as { limits?: Record<string, unknown>; countedRoles?: unknown };
    const limits: SeatPolicyRule['limits'] = {};
    for (const tier of SEAT_TIERS) {
      const n = boundedInt(v.limits?.[tier], 1, 1000);
      if (n !== null) limits[tier] = n;
    }
    const roles = Array.isArray(v.countedRoles) ? v.countedRoles.filter((r): r is SeatPolicyRule['countedRoles'][number] => (SEAT_ROLES as readonly unknown[]).includes(r)) : [];
    if (!row || roles.length === 0) this.logger.error(`RuleConfig "${SEAT_LIMITS_RULE_KEY}" missing or without roles; counting Owner/Manager and Staff`);
    return { limits, countedRoles: roles.length > 0 ? roles : ['OWNER_MANAGER', 'STAFF'], validated: !!row?.validatedBy };
  }
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
