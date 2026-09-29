import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { GuestCheckIn, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { StorageService } from '../storage/storage.service';
import { linkStatus } from './links.service';
import { parseIsoDate, UpdateGuestDto } from './dto';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
const DAY_MS = 86_400_000;
const SUBMITTED = ['SUBMITTED', 'VERIFIED'] as const;
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

type GuestWithMeta = GuestCheckIn & { docImage: { deletedAt: Date | null } | null; fiche: { id: string } | null };

/** Status for everyone with `guest:read_meta`; the fields only with `police:read` (Owner/Manager). */
function guestView(g: GuestWithMeta, role: AuthUser['role']) {
  const status = {
    id: g.id,
    bookingId: g.bookingId,
    propertyId: g.propertyId,
    guestIndex: g.guestIndex,
    status: g.status,
    submittedAt: g.submittedAt,
    hasDocument: !!g.docImageId && !g.docImage?.deletedAt,
    hasFiche: !!g.fiche,
  };
  if (!can(role, 'police:read')) return status;
  const ocr = (g.ocrFieldsFlagged ?? {}) as { flagged?: string[]; edited?: string[] };
  return {
    ...status,
    fields: {
      docType: g.docType,
      fullName: g.fullName,
      nationality: g.nationality,
      docNumber: g.docNumber,
      dob: isoDay(g.dob),
      docExpiryDate: isoDay(g.docExpiryDate),
      declaredMoroccanNationality: g.declaredMoroccanNationality,
      entryStampNumber: g.entryStampNumber,
      cityOfOrigin: g.cityOfOrigin,
      nextDestination: g.nextDestination,
      profession: g.profession,
    },
    consent: { at: g.consentAt, textId: g.consentTextId },
    ocr: { confidence: g.ocrConfidence, flagged: ocr.flagged ?? [], edited: ocr.edited ?? [] },
  };
}

@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async guest(user: AuthUser, id: string): Promise<GuestWithMeta> {
    // Drafts (PENDING) are the guest's unfinished form: not visible to the team.
    const g = await this.prisma.forAccount(user.accountId).guestCheckIn.findFirst({
      where: { id, status: { in: [...SUBMITTED] } },
      include: { docImage: { select: { deletedAt: true } }, fiche: { select: { id: true } } },
    });
    if (!g) throw notFound();
    return g;
  }

  /** Upcoming and current stays with check-in status per guest. Staff see status only (no names). */
  async arrivals(user: AuthUser, propertyId: string, days = 60) {
    const db = this.prisma.forAccount(user.accountId);
    if (!(await db.property.findFirst({ where: { id: propertyId }, select: { id: true } }))) throw notFound();
    const today = new Date(new Date().toISOString().slice(0, 10));
    const bookings = await db.booking.findMany({
      where: { propertyId, status: 'CONFIRMED', classification: 'BOOKING', checkOut: { gte: today }, checkIn: { lte: new Date(today.getTime() + days * DAY_MS) } },
      orderBy: { checkIn: 'asc' },
      take: 200,
      select: { id: true, checkIn: true, checkOut: true, partySize: true, source: true },
    });
    const ids = bookings.map((b) => b.id);
    const [guests, links] = ids.length
      ? await Promise.all([
          db.guestCheckIn.findMany({
            where: { bookingId: { in: ids }, status: { in: [...SUBMITTED] } },
            orderBy: { guestIndex: 'asc' },
            include: { fiche: { select: { id: true } } },
          }),
          db.checkInLink.findMany({ where: { bookingId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
        ])
      : [[], []];
    const names = can(user.role, 'police:read');
    const now = new Date();

    return bookings.map((b) => {
      const mine = guests.filter((g) => g.bookingId === b.id);
      const latest = links.find((l) => l.bookingId === b.id) ?? null;
      const expected = latest?.maxGuests ?? b.partySize ?? null;
      const state = mine.length === 0 ? (latest && linkStatus(latest, now) === 'ACTIVE' ? 'LINK_SENT' : 'NONE') : expected !== null && mine.length >= expected ? 'COMPLETE' : 'PARTIAL';
      return {
        bookingId: b.id,
        checkIn: isoDay(b.checkIn),
        checkOut: isoDay(b.checkOut),
        partySize: b.partySize,
        source: b.source,
        checkinStatus: state,
        guests: mine.map((g) => ({ id: g.id, guestIndex: g.guestIndex, status: g.status, submittedAt: g.submittedAt, hasFiche: !!g.fiche, ...(names ? { fullName: g.fullName } : {}) })),
        link: latest ? { id: latest.id, status: linkStatus(latest, now), expiresAt: latest.expiresAt, guestsSubmitted: latest.guestsSubmitted, maxGuests: latest.maxGuests } : null,
      };
    });
  }

  async get(user: AuthUser, id: string) {
    return guestView(await this.guest(user, id), user.role);
  }

  /** Manager corrections (e.g. an OCR slip the guest did not catch). The Fiche is regenerated separately. */
  async update(user: AuthUser, id: string, dto: UpdateGuestDto, meta: ClientMeta) {
    const g = await this.guest(user, id);
    const dob = dto.dob !== undefined ? parseIsoDate(dto.dob) : undefined;
    const expiry = dto.docExpiryDate !== undefined ? parseIsoDate(dto.docExpiryDate) : undefined;
    const bad = [
      ...(dob === null || (dob && dob > new Date()) ? [{ field: 'dob', errors: ['Enter a valid date.'] }] : []),
      ...(expiry === null ? [{ field: 'docExpiryDate', errors: ['Enter a valid date.'] }] : []),
    ];
    if (bad.length) throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'Request validation failed.', details: bad });

    // The date strings are validated above and stored as dates; `verified` only moves the status.
    const { verified, ...rest } = dto;
    delete rest.dob;
    delete rest.docExpiryDate;
    const data: Prisma.GuestCheckInUncheckedUpdateManyInput = {
      ...rest,
      ...(dob ? { dob } : {}),
      ...(expiry ? { docExpiryDate: expiry } : {}),
      ...(verified ? { status: 'VERIFIED' } : {}),
    };
    if (Object.keys(data).length === 0) return this.get(user, id);
    await this.prisma.forAccount(user.accountId).guestCheckIn.update({ where: { id: g.id }, data });
    // Identifiers only: which guest, never the values.
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'guest.updated', resourceType: 'GuestCheckIn', resourceId: g.id, ip: meta.ip });
    return this.get(user, id);
  }

  /** The stored image, decrypted in memory. Owner/Manager only; every read is audited before any byte is returned. */
  async document(user: AuthUser, id: string, meta: ClientMeta): Promise<Buffer> {
    const g = await this.guest(user, id);
    if (!g.docImageId || g.docImage?.deletedAt) throw notFound();
    const read = await this.storage.read(user.accountId, g.docImageId, {
      actorId: user.id,
      action: 'guest.document.read',
      resourceType: 'GuestCheckIn',
      resourceId: g.id,
      ip: meta.ip,
    });
    return read.bytes;
  }
}
