import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInLink } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { randomToken, hashToken } from '../auth/tokens';
import { RulesService } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MessagingService } from '../messaging/messaging.service';
import { nameVariable, normalizePhone } from '../messaging/phone';
import { PrismaService } from '../prisma/prisma.service';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

export type LinkStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'COMPLETED';

export function linkStatus(link: Pick<CheckInLink, 'revokedAt' | 'expiresAt' | 'guestsSubmitted' | 'maxGuests'>, now = new Date()): LinkStatus {
  if (link.revokedAt) return 'REVOKED';
  if (link.guestsSubmitted >= link.maxGuests) return 'COMPLETED';
  if (link.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

/** Never includes the token or its hash. */
export function linkView(link: CheckInLink, now = new Date()) {
  return {
    id: link.id,
    bookingId: link.bookingId,
    status: linkStatus(link, now),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    guestsSubmitted: link.guestsSubmitted,
    maxGuests: link.maxGuests,
  };
}

/** What the guest may do with a link ends `grace hours` after the booked checkout date (00:00 UTC of that date). */
export function linkExpiry(checkOut: Date, graceHours: number): Date {
  return new Date(checkOut.getTime() + graceHours * 3_600_000);
}

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly messaging: MessagingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The guest link puts the token in the URL fragment (`#token=`): a fragment is never sent to any server, so
   * it stays out of proxy logs and out of the link-preview requests that chat apps such as WhatsApp make.
   */
  private urlFor(token: string) {
    return `${this.config.APP_URL.replace(/\/$/, '')}/checkin#token=${token}`;
  }

  private async bookingFor(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.forAccount(user.accountId).booking.findFirst({ where: { id: bookingId } });
    if (!booking) throw notFound();
    if (booking.status !== 'CONFIRMED' || booking.classification !== 'BOOKING') {
      throw new ConflictException({ code: 'BOOKING_NOT_ELIGIBLE', message: 'Check-in links are only for confirmed bookings.' });
    }
    return booking;
  }

  /** Guests already submitted for the booking count against the party, whichever link they used. */
  private async issue(user: AuthUser, booking: { id: string; checkOut: Date; partySize: number | null }, maxGuests: number | undefined) {
    const db = this.prisma.forAccount(user.accountId);
    const grace = await this.rules.checkinGrace();
    const expiresAt = linkExpiry(booking.checkOut, grace.hours);
    if (expiresAt <= new Date()) {
      throw new ConflictException({ code: 'LINK_WINDOW_CLOSED', message: 'This stay is too far in the past for a check-in link.' });
    }
    const submitted = await db.guestCheckIn.count({ where: { bookingId: booking.id, status: { in: ['SUBMITTED', 'VERIFIED'] } } });
    const max = maxGuests ?? Math.min(10, Math.max(1, booking.partySize ?? 2));
    if (submitted >= max) {
      throw new ConflictException({ code: 'PARTY_COMPLETE', message: 'Every expected guest has already checked in.' });
    }
    const token = randomToken();
    const link = await db.checkInLink.create({
      data: { accountId: user.accountId, bookingId: booking.id, tokenHash: hashToken(token), expiresAt, createdBy: user.id, guestsSubmitted: submitted, maxGuests: max },
    });
    return { link, token };
  }

  /** A malformed number is refused before anything is issued. Null when none was given. */
  private phoneOf(whatsappTo: string | undefined): string | null {
    if (whatsappTo === undefined) return null;
    const phone = normalizePhone(whatsappTo);
    if (!phone) throw new BadRequestException({ code: 'INVALID_PHONE', message: 'Enter the number with its country code, for example +212 6 12 34 56 78.' });
    return phone;
  }

  /**
   * Sends the link by WhatsApp when a number was given. The link exists whatever happens here: if WhatsApp is off,
   * not ready or fails, the caller still has the URL to copy (there is no guest e-mail to fall back to).
   */
  private async deliver(user: AuthUser, booking: { propertyId: string }, linkId: string, url: string, phone: string | null) {
    if (!phone) return null;
    const property = await this.prisma.forAccount(user.accountId).property.findFirst({ where: { id: booking.propertyId }, select: { name: true } });
    const r = await this.messaging.send({ accountId: user.accountId, kind: 'checkin_link', subject: { type: 'CHECKIN_LINK', id: linkId }, whatsappTo: phone, variables: [nameVariable(property?.name ?? '-'), url], actorId: user.id });
    return { channel: r.channel, status: r.status, skipped: r.skipped };
  }

  async create(user: AuthUser, bookingId: string, maxGuests: number | undefined, whatsappTo: string | undefined, meta: ClientMeta) {
    const phone = this.phoneOf(whatsappTo);
    const booking = await this.bookingFor(user, bookingId);
    const { link, token } = await this.issue(user, booking, maxGuests);
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checkin.link.created', resourceType: 'CheckInLink', resourceId: link.id, ip: meta.ip });
    // The only time the token is ever returned.
    const url = this.urlFor(token);
    return { ...linkView(link), token, url, delivery: await this.deliver(user, booking, link.id, url, phone) };
  }

  /** Delivery attempts for one link (WhatsApp, then the fallback if any), for the arrivals screen. */
  async deliveries(user: AuthUser, linkId: string) {
    if (!(await this.prisma.forAccount(user.accountId).checkInLink.findFirst({ where: { id: linkId }, select: { id: true } }))) throw notFound();
    return this.messaging.deliveriesFor(user.accountId, 'CHECKIN_LINK', linkId);
  }

  async list(user: AuthUser, bookingId: string) {
    const db = this.prisma.forAccount(user.accountId);
    if (!(await db.booking.findFirst({ where: { id: bookingId }, select: { id: true } }))) throw notFound();
    const links = await db.checkInLink.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
    return links.map((l) => linkView(l));
  }

  async revoke(user: AuthUser, linkId: string, meta: ClientMeta): Promise<void> {
    const db = this.prisma.forAccount(user.accountId);
    const link = await db.checkInLink.findFirst({ where: { id: linkId } });
    if (!link) throw notFound();
    if (link.revokedAt) return; // idempotent
    await db.checkInLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checkin.link.revoked', resourceType: 'CheckInLink', resourceId: linkId, ip: meta.ip });
  }

  /** A fresh token replaces the old one, which stops working at once. */
  async resend(user: AuthUser, linkId: string, whatsappTo: string | undefined, meta: ClientMeta) {
    const phone = this.phoneOf(whatsappTo);
    const db = this.prisma.forAccount(user.accountId);
    const old = await db.checkInLink.findFirst({ where: { id: linkId } });
    if (!old) throw notFound();
    const booking = await this.bookingFor(user, old.bookingId);
    const { link, token } = await this.issue(user, booking, old.maxGuests);
    if (!old.revokedAt) {
      await db.checkInLink.update({ where: { id: old.id }, data: { revokedAt: new Date() } });
      await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checkin.link.revoked', resourceType: 'CheckInLink', resourceId: old.id, ip: meta.ip });
    }
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checkin.link.created', resourceType: 'CheckInLink', resourceId: link.id, ip: meta.ip });
    const url = this.urlFor(token);
    return { ...linkView(link), token, url, delivery: await this.deliver(user, booking, link.id, url, phone) };
  }
}
