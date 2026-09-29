import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PropertyEvents } from '../common/property-events';
import { BookingsService, currentYear } from '../compliance/bookings.service';
import { DayCounterRule, RulesService } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export const ALERT_AMBER = 'day_counter.amber';
export const ALERT_RED = 'day_counter.red';

const FIELDS = { id: true, type: true, severity: true, propertyId: true, year: true, message: true, createdAt: true, resolvedAt: true, readAt: true } as const;

/**
 * Threshold alerts for the 120-night counter. One alert per (account, type, property, year): the unique
 * key makes evaluation idempotent, so it can run after every sync, import or reclassification and on a
 * schedule without ever sending a second email for the same threshold.
 */
@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger('Alerts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly rules: RulesService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly events: PropertyEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.events.onNightsChanged((accountId, propertyId) => this.evaluateProperty(accountId, propertyId));
  }

  /** Checks one property for the current year; creates and emails the alerts that are now due. */
  async evaluateProperty(accountId: string, propertyId: string, year = currentYear()): Promise<string[]> {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, accountId }, select: { id: true, name: true, licenseStatus: true } });
    if (!property || property.licenseStatus !== 'UNLICENSED') return [];

    const rule = await this.rules.dayCounter();
    const counter = await this.bookings.dayCounter({ id: 'system', accountId, role: 'OWNER_MANAGER' }, propertyId, year);
    const due: { type: string; severity: Severity }[] = [];
    if (counter.nights >= rule.red) due.push({ type: ALERT_RED, severity: 'RED' });
    if (counter.nights >= rule.amber) due.push({ type: ALERT_AMBER, severity: 'AMBER' });

    const created: string[] = [];
    for (const d of due) {
      const inserted = await this.createOnce(accountId, property.id, d.type, d.severity, year, this.message(d.type, property.name, counter.nights, rule));
      if (inserted) created.push(d.type);
    }
    if (created.length) {
      // One email even if both thresholds were crossed at once (e.g. after a large import): the highest.
      const top = created.includes(ALERT_RED) ? ALERT_RED : ALERT_AMBER;
      await this.notify(accountId, property.name, top, counter.nights, rule, year);
    }
    return created;
  }

  /** Evaluates every unlicensed property of one account, or of all accounts (scheduled run). */
  async evaluateAll(accountId?: string, year = currentYear()): Promise<number> {
    const properties = await this.prisma.property.findMany({ where: { licenseStatus: 'UNLICENSED', ...(accountId ? { accountId } : {}) }, select: { id: true, accountId: true } });
    let created = 0;
    for (const p of properties) created += (await this.evaluateProperty(p.accountId, p.id, year).catch((e) => (this.logger.error(`property ${p.id}: ${e instanceof Error ? e.message : String(e)}`), []))).length;
    return created;
  }

  list(user: AuthUser, opts: { open?: boolean } = {}) {
    return this.prisma.forAccount(user.accountId).notification.findMany({
      where: { type: { startsWith: 'day_counter.' }, ...(opts.open ? { resolvedAt: null } : {}) },
      select: FIELDS,
      orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async resolve(user: AuthUser, id: string, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    const { count } = await db.notification.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), readAt: new Date() } });
    if (count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Alert not found.' });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'alert.resolved', resourceType: 'Notification', resourceId: id, ip: meta.ip });
    return db.notification.findUniqueOrThrow({ where: { id }, select: FIELDS });
  }

  private async createOnce(accountId: string, propertyId: string, type: string, severity: Severity, year: number, message: string): Promise<boolean> {
    try {
      await this.prisma.notification.create({ data: { accountId, propertyId, type, severity, year, message, sentVia: ['dashboard'] } });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false;
      throw e;
    }
  }

  private message(type: string, name: string, nights: number, rule: DayCounterRule) {
    const threshold = type === ALERT_RED ? rule.red : rule.amber;
    return `${name}: ${nights} nights counted this year (alert at ${threshold}, limit in your rules: ${rule.cap}).`;
  }

  private async notify(accountId: string, propertyName: string, type: string, nights: number, rule: DayCounterRule, year: number) {
    const managers = await this.prisma.user.findMany({ where: { accountId, role: 'OWNER_MANAGER', disabledAt: null }, select: { email: true } });
    const red = type === ALERT_RED;
    const link = `${this.config.APP_URL}/properties`;
    const notice = rule.validated ? '' : '\n\nLes seuils sont ceux de vos règles ; ils n\'ont pas encore été confirmés par un professionnel. / The thresholds come from your rules and have not yet been confirmed by a professional.';
    for (const m of managers) {
      await this.mail
        .send({
          to: m.email,
          subject: red ? `Alerte critique — ${propertyName} (${nights} nuits) / Critical alert` : `Alerte préventive — ${propertyName} (${nights} nuits) / Early warning`,
          text:
            `${propertyName} : ${nights} nuits comptées en ${year}. Seuil ${red ? 'critique' : 'préventif'} atteint.\n` +
            `Vérifiez le détail des nuits et les événements à confirmer : ${link}\n\n` +
            `${propertyName}: ${nights} nights counted in ${year}. ${red ? 'Critical' : 'Early-warning'} threshold reached.\n` +
            `Check the nights and any events waiting for review: ${link}` +
            notice +
            `\n\nCe message est une aide à la décision, pas un avis juridique. / This message is decision support, not legal advice.`,
        })
        .catch((e: unknown) => this.logger.error(`alert mail failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    await this.prisma.notification.updateMany({ where: { accountId, type, year, sentVia: { equals: ['dashboard'] } }, data: { sentVia: ['dashboard', 'email'] } });
  }
}
