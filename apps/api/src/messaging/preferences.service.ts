import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { PreferredChannel } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { RulesService } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { maskPhone, normalizePhone } from './phone';

/** The alerts a user can choose a channel for. */
export const ALERT_TYPES = ['day_counter.amber', 'day_counter.red'] as const;
export const DEFAULT_CHANNEL: PreferredChannel = 'EMAIL';

@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The number is shown masked: it is never sent back in full. */
  async get(user: AuthUser) {
    const [me, rows, templates] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } }),
      this.prisma.forAccount(user.accountId).notificationPreference.findMany({ where: { userId: user.id }, select: { alertType: true, channel: true } }),
      this.rules.whatsappTemplates(),
    ]);
    const chosen = new Map(rows.map((r) => [r.alertType, r.channel]));
    return {
      // `ready`: alerts can go by WhatsApp; `checkinLink` and `shareLink`: the screens may offer to send those. Each needs the switch and an approved template.
      whatsapp: {
        enabled: this.config.WHATSAPP_ENABLED,
        ready: this.config.WHATSAPP_ENABLED && templates.templates.day_counter_alert !== undefined,
        checkinLink: this.config.WHATSAPP_ENABLED && templates.templates.checkin_link !== undefined,
        shareLink: this.config.WHATSAPP_ENABLED && templates.templates.share_link !== undefined,
      },
      phone: me.phone ? maskPhone(me.phone) : null,
      preferences: ALERT_TYPES.map((alertType) => ({ alertType, channel: chosen.get(alertType) ?? DEFAULT_CHANNEL })),
    };
  }

  async set(user: AuthUser, alertType: string, channel: PreferredChannel) {
    if (!(ALERT_TYPES as readonly string[]).includes(alertType)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Unknown alert type.' });
    if (channel === 'WHATSAPP' || channel === 'BOTH') {
      if (!this.config.WHATSAPP_ENABLED) throw new UnprocessableEntityException({ code: 'WHATSAPP_UNAVAILABLE', message: 'WhatsApp is not available yet.' });
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true } });
      if (!me.phone) throw new UnprocessableEntityException({ code: 'PHONE_REQUIRED', message: 'Add your WhatsApp number first.' });
    }
    await this.prisma.forAccount(user.accountId).notificationPreference.upsert({
      where: { userId_alertType: { userId: user.id, alertType } },
      create: { accountId: user.accountId, userId: user.id, alertType, channel },
      update: { channel },
    });
    return this.get(user);
  }

  /** `null` removes the number and moves every WhatsApp choice back to e-mail, so nothing is left waiting for a number that is gone. */
  async setPhone(user: AuthUser, input: string | null, meta: ClientMeta) {
    let phone: string | null = null;
    if (input !== null) {
      phone = normalizePhone(input);
      if (!phone) throw new BadRequestException({ code: 'INVALID_PHONE', message: 'Enter the number with its country code, for example +212 6 12 34 56 78.' });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { phone } }),
      ...(phone === null ? [this.prisma.notificationPreference.updateMany({ where: { userId: user.id, accountId: user.accountId, channel: { in: ['WHATSAPP', 'BOTH'] } }, data: { channel: DEFAULT_CHANNEL } })] : []),
    ]);
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'user.phone_changed', resourceType: 'User', resourceId: user.id, ip: meta.ip });
    return this.get(user);
  }
}
