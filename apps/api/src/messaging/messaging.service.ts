import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MessageStatus, MessageSubject } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { RulesService, WhatsAppTemplateKind } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { inQuietHours, startOfLocalDay } from './quiet-hours';
import { StatusReport } from './signature';
import { OutgoingTemplate, WHATSAPP_PROVIDER, WhatsAppProvider, WhatsAppProviderError } from './whatsapp.provider';
import { templateVariable } from './phone';

export interface EmailFallback {
  to: string;
  subject: string;
  text: string;
}

export interface SendInput {
  accountId: string;
  kind: WhatsAppTemplateKind;
  /** The record the message is about (a check-in link, an alert): shown as its delivery status. */
  subject: { type: MessageSubject; id: string };
  /** E.164, already normalised. Used for this send and stored nowhere. */
  whatsappTo?: string | null;
  /** Positional variables of the approved template. */
  variables: string[];
  /** Urgent messages (a critical alert) may go out during quiet hours. */
  urgent?: boolean;
  /** Sent when WhatsApp is not used or fails. Without it the caller shows the content on screen. */
  email?: EmailFallback | null;
  actorId?: string | null;
}

/** Why WhatsApp was not used, when it was not. Nothing here is personal data. */
export type Skipped = 'DISABLED' | 'NO_NUMBER' | 'NO_TEMPLATE' | 'QUIET_HOURS' | 'CAP_REACHED';

export interface SendResult {
  /** The channel that carried the message (or was last tried); null when nothing was sent. */
  channel: 'WHATSAPP' | 'EMAIL' | null;
  status: MessageStatus | null;
  deliveryId: string | null;
  skipped: Skipped | null;
}

/** A delivery report can only move a message forward. */
const RANK: Record<MessageStatus, number> = { QUEUED: 0, FAILED: 0, FELL_BACK: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * One place that decides how a message leaves: WhatsApp when it is on, the recipient has a number, an approved
 * template exists, it is not quiet hours (unless urgent) and the account's daily cap is not spent; otherwise, or if
 * WhatsApp fails, by e-mail when the caller gave one. Every attempt is one `MessageDelivery` row (ids, template
 * name, status, a fixed failure code): never the body, a link, a token or a number. Quiet hours and the cap apply to
 * WhatsApp only: e-mail is not an interruption and is not billed per message.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly mail: MailService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async send(input: SendInput, now = new Date()): Promise<SendResult> {
    const skipped = await this.whatsappSkipReason(input, now);
    let template: { name: string; language: string } | undefined;
    if (!skipped) template = (await this.rules.whatsappTemplates()).templates[input.kind];

    if (!skipped && template && input.whatsappTo) {
      const row = await this.prisma.messageDelivery.create({
        data: { accountId: input.accountId, channel: 'WHATSAPP', template: template.name, subjectType: input.subject.type, subjectId: input.subject.id },
        select: { id: true },
      });
      const message: OutgoingTemplate = { to: input.whatsappTo, name: template.name, language: template.language, variables: input.variables.map((v) => templateVariable(v)) };
      try {
        const { providerMessageId } = await this.provider.send(message);
        await this.prisma.messageDelivery.update({ where: { id: row.id }, data: { status: 'SENT', providerMessageId } });
        await this.audit.record({ accountId: input.accountId, actorId: input.actorId ?? null, action: 'message.sent', resourceType: 'MessageDelivery', resourceId: row.id });
        return { channel: 'WHATSAPP', status: 'SENT', deliveryId: row.id, skipped: null };
      } catch (e) {
        const failureCode = e instanceof WhatsAppProviderError ? e.code : 'PROVIDER_UNREACHABLE';
        // Type and code only: the error of a provider or a network can quote the number.
        this.logger.error(`whatsapp send failed for delivery ${row.id}: ${failureCode}`);
        await this.prisma.messageDelivery.update({ where: { id: row.id }, data: { status: 'FAILED', failureCode } });
        if (!input.email) return { channel: 'WHATSAPP', status: 'FAILED', deliveryId: row.id, skipped: null };
        const fallback = await this.sendEmail(input, input.email);
        if (fallback.status === 'SENT') await this.prisma.messageDelivery.update({ where: { id: row.id }, data: { status: 'FELL_BACK' } });
        return fallback;
      }
    }

    if (!input.email) return { channel: null, status: null, deliveryId: null, skipped: skipped ?? 'NO_TEMPLATE' };
    return { ...(await this.sendEmail(input, input.email)), skipped: skipped ?? 'NO_TEMPLATE' };
  }

  private async whatsappSkipReason(input: SendInput, now: Date): Promise<Skipped | null> {
    if (!this.config.WHATSAPP_ENABLED) return 'DISABLED';
    if (!input.whatsappTo) return 'NO_NUMBER';
    const { templates } = await this.rules.whatsappTemplates();
    if (!templates[input.kind]) return 'NO_TEMPLATE';
    const quiet = await this.rules.quietHours();
    if (!input.urgent && inQuietHours(now, quiet)) return 'QUIET_HOURS';
    const cap = await this.rules.dailyCap();
    const today = await this.prisma.messageDelivery.count({
      where: { accountId: input.accountId, channel: 'WHATSAPP', status: { not: 'FAILED' }, createdAt: { gte: startOfLocalDay(now, quiet.timezone) } },
    });
    // A soft cap: two requests racing may pass together, by one message each at most.
    return today >= cap.messages ? 'CAP_REACHED' : null;
  }

  private async sendEmail(input: SendInput, email: EmailFallback): Promise<SendResult> {
    const row = await this.prisma.messageDelivery.create({
      data: { accountId: input.accountId, channel: 'EMAIL', template: input.kind, subjectType: input.subject.type, subjectId: input.subject.id },
      select: { id: true },
    });
    try {
      await this.mail.send(email);
    } catch {
      // The mail driver's error carries the HTTP status at most; nothing about the recipient or the body is kept.
      await this.prisma.messageDelivery.update({ where: { id: row.id }, data: { status: 'FAILED', failureCode: 'MAIL_FAILED' } });
      return { channel: 'EMAIL', status: 'FAILED', deliveryId: row.id, skipped: null };
    }
    await this.prisma.messageDelivery.update({ where: { id: row.id }, data: { status: 'SENT' } });
    await this.audit.record({ accountId: input.accountId, actorId: input.actorId ?? null, action: 'message.sent', resourceType: 'MessageDelivery', resourceId: row.id });
    return { channel: 'EMAIL', status: 'SENT', deliveryId: row.id, skipped: null };
  }

  /** Applies Meta's delivery reports. Idempotent and forward-only: a replay or an out-of-order report changes nothing. Unknown ids are ignored. */
  async applyReports(reports: StatusReport[]): Promise<number> {
    let applied = 0;
    for (const r of reports) {
      const row = await this.prisma.messageDelivery.findUnique({ where: { channel_providerMessageId: { channel: 'WHATSAPP', providerMessageId: r.providerMessageId } }, select: { id: true, status: true } });
      if (!row) continue;
      if (r.status === 'FAILED') {
        // A report of failure after we saw it delivered or read is stale; before that, it is real.
        if (RANK[row.status] >= RANK.DELIVERED || row.status === 'FAILED' || row.status === 'FELL_BACK') continue;
        const { count } = await this.prisma.messageDelivery.updateMany({ where: { id: row.id, status: row.status }, data: { status: 'FAILED', failureCode: 'REPORTED_FAILED' } });
        applied += count;
        continue;
      }
      if (RANK[r.status] <= RANK[row.status]) continue;
      const { count } = await this.prisma.messageDelivery.updateMany({ where: { id: row.id, status: row.status }, data: { status: r.status } });
      applied += count;
    }
    return applied;
  }

  /** Delivery status of one record, oldest first. The caller has already checked that the record belongs to the account. */
  deliveriesFor(accountId: string, type: MessageSubject, id: string) {
    return this.prisma.forAccount(accountId).messageDelivery.findMany({
      where: { subjectType: type, subjectId: id },
      select: { id: true, channel: true, status: true, failureCode: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
