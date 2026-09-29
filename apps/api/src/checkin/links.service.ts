import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInLink } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { randomToken, hashToken } from '../auth/tokens';
import { RulesService } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
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

  async create(user: AuthUser, bookingId: string, maxGuests: number | undefined, meta: ClientMeta) {
    const booking = await this.bookingFor(user, bookingId);
    const { link, token } = await this.issue(user, booking, maxGuests);
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checkin.link.created', resourceType: 'CheckInLink', resourceId: link.id, ip: meta.ip });
    // The only time the token is ever returned.
    return { ...linkView(link), token, url: this.urlFor(token) };
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
  async resend(user: AuthUser, linkId: string, meta: ClientMeta) {
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
    return { ...linkView(link), token, url: this.urlFor(token) };
  }
}
