import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ClientMeta } from '../auth/auth.types';
import { hashToken } from '../auth/tokens';
import { WindowCounter } from '../common/window-counter';
import { RulesService } from '../compliance/rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConsentService } from './consent.service';
import { FicheService } from './fiche.service';
import { parseIsoDate, SubmitDto } from './dto';
import { ImageRejectedError, MAX_UPLOAD_BYTES, sanitizeImage } from './image-sanitizer';
import { OcrClient, OcrOutcome, suggestionHashes } from './ocr.client';

export const WINDOW_COUNTER = Symbol('WINDOW_COUNTER');

export const MAX_UPLOADS_PER_GUEST = 3;
const WINDOW_MS = 15 * 60_000;
const MAX_UPLOADS_PER_LINK_WINDOW = 10;
const MAX_SUBMITS_PER_LINK_WINDOW = 20;
const DAY_MS = 86_400_000;

/**
 * The four fields the police form needs, always required (rule 5 in CLAUDE.md). Enforced by SubmitDto and
 * listed here so the form and the server cannot drift apart.
 */
export const REQUIRED_FIELDS = ['entryStampNumber', 'cityOfOrigin', 'nextDestination', 'profession'] as const;

/** Unknown, expired, revoked, full and cancelled-booking links all give this one answer. */
const linkUnavailable = () => new NotFoundException({ code: 'LINK_UNAVAILABLE', message: 'This link is not available.' });
const draftNotFound = () => new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Not found.' });
const tooMany = (code: string) => new HttpException({ code, message: 'Too many attempts. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class PublicCheckInService {
  private readonly logger = new Logger('CheckIn');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly consent: ConsentService,
    private readonly storage: StorageService,
    private readonly ocr: OcrClient,
    private readonly rules: RulesService,
    private readonly fiche: FicheService,
    @Inject(WINDOW_COUNTER) private readonly counter: WindowCounter,
  ) {}

  /**
   * Finds the live link for a token. Runs before an account is known, so it reads through the unscoped client by
   * the unique token hash; every later read and write goes through `forAccount(link.accountId)`.
   */
  private async resolve(rawToken: unknown) {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw linkUnavailable();
    const link = await this.prisma.checkInLink.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { booking: { select: { id: true, propertyId: true, checkIn: true, checkOut: true, status: true, classification: true, property: { select: { name: true } } } } },
    });
    const live =
      link && !link.revokedAt && link.expiresAt > new Date() && link.guestsSubmitted < link.maxGuests && link.booking.status === 'CONFIRMED' && link.booking.classification === 'BOOKING';
    if (!link || !live) throw linkUnavailable();
    return { link, booking: link.booking, accountId: link.accountId, db: this.prisma.forAccount(link.accountId) };
  }

  private async limit(key: string, max: number, code: string) {
    if ((await this.counter.hit(key, WINDOW_MS)) > max) throw tooMany(code);
  }

  /** Booking dates and property name only: enough for the guest to recognise the stay, nothing about anyone else. */
  async view(rawToken: unknown, lang: string | undefined) {
    const { link, booking } = await this.resolve(rawToken);
    const wording = await this.consent.current(lang ?? 'fr');
    if (!wording) throw new ServiceUnavailableException({ code: 'CHECKIN_UNAVAILABLE', message: 'Check-in is not available at the moment.' });
    return {
      property: { name: booking.property.name },
      stay: { checkIn: isoDay(booking.checkIn), checkOut: isoDay(booking.checkOut) },
      guests: { submitted: link.guestsSubmitted, max: link.maxGuests, remaining: link.maxGuests - link.guestsSubmitted },
      consent: wording,
      limits: { maxImageBytes: MAX_UPLOAD_BYTES, maxUploadsPerGuest: MAX_UPLOADS_PER_GUEST },
      requiredFields: REQUIRED_FIELDS,
    };
  }

  async upload(rawToken: unknown, file: { buffer: Buffer } | undefined, draftId: string | undefined) {
    const { link, booking, accountId, db } = await this.resolve(rawToken);
    await this.limit(`checkin-up:${link.id}`, MAX_UPLOADS_PER_LINK_WINDOW, 'TOO_MANY_UPLOADS');
    if (!file?.buffer?.length) throw new UnprocessableEntityException({ code: 'IMAGE_REQUIRED', message: 'A photo is required.' });

    let jpeg: Buffer;
    try {
      ({ jpeg } = await sanitizeImage(file.buffer));
    } catch (e) {
      if (e instanceof ImageRejectedError) {
        if (e.code === 'IMAGE_TOO_LARGE') throw new PayloadTooLargeException({ code: e.code, message: 'The photo is too large.' });
        throw new UnprocessableEntityException({ code: e.code, message: e.code === 'IMAGE_TOO_SMALL' ? 'The photo is too small to read.' : 'This file is not a usable photo.' });
      }
      throw e;
    }

    // The draft: an existing one of this link, or a new one (bounded, so a held link cannot fill storage).
    let draft;
    if (draftId) {
      draft = await db.guestCheckIn.findFirst({ where: { id: draftId, linkId: link.id, status: 'PENDING' } });
      if (!draft) throw draftNotFound();
    } else {
      const open = await db.guestCheckIn.count({ where: { linkId: link.id, status: 'PENDING' } });
      if (open >= link.maxGuests + 2) throw tooMany('TOO_MANY_DRAFTS');
      draft = await db.guestCheckIn.create({ data: { accountId, bookingId: booking.id, propertyId: booking.propertyId, linkId: link.id } });
    }
    // Reserve one of the three photos atomically: parallel uploads cannot exceed the cap.
    const reserved = await db.guestCheckIn.updateMany({ where: { id: draft.id, status: 'PENDING', uploadCount: { lt: MAX_UPLOADS_PER_GUEST } }, data: { uploadCount: { increment: 1 } } });
    if (reserved.count === 0) throw tooMany('TOO_MANY_IMAGES');

    const retention = await this.rules.idRetention();
    const stored = await this.storage.put(accountId, 'ID_IMAGE', jpeg, { expiresAt: new Date(booking.checkOut.getTime() + retention.days * DAY_MS) });

    const outcome = await this.ocr.extract(jpeg);
    const artefacts = { status: outcome.status, flagged: outcome.flagged, suggestedHashes: suggestionHashes(outcome.suggestion, draft.id) };
    const updated = await db.guestCheckIn.updateMany({
      where: { id: draft.id, status: 'PENDING' },
      data: { docImageId: stored.id, ocrConfidence: outcome.confidence, ocrFieldsFlagged: artefacts as Prisma.InputJsonValue },
    });
    if (updated.count !== 1) {
      await this.discard(accountId, stored.id, draft.id);
      throw draftNotFound();
    }
    if (draft.docImageId) await this.discard(accountId, draft.docImageId, draft.id); // the previous photo is replaced, not kept

    return { draftId: draft.id, uploadsLeft: MAX_UPLOADS_PER_GUEST - (draft.uploadCount + 1), ocr: this.forGuest(outcome) };
  }

  /** What the guest form gets back: the suggestions, never the stored image or anything derived from other guests. */
  private forGuest(o: OcrOutcome) {
    return { status: o.status, reason: o.reason, suggestion: o.suggestion, flagged: o.flagged, unverified: o.unverified, confidence: o.confidence, quality: o.quality };
  }

  private async discard(accountId: string, objectId: string, guestId: string) {
    await this.storage
      .delete(accountId, objectId, { actorId: null, action: 'storage.object.deleted', resourceType: 'GuestCheckIn', resourceId: guestId })
      .catch(() => this.logger.warn(`could not remove a replaced document for guest ${guestId}`));
  }

  async submit(rawToken: unknown, dto: SubmitDto, meta: ClientMeta) {
    const { link, accountId, db } = await this.resolve(rawToken);
    await this.limit(`checkin-sub:${link.id}`, MAX_SUBMITS_PER_LINK_WINDOW, 'TOO_MANY_ATTEMPTS');

    const draft = await db.guestCheckIn.findFirst({ where: { id: dto.draftId, linkId: link.id, status: 'PENDING' }, include: { docImage: { select: { deletedAt: true } } } });
    if (!draft) throw draftNotFound();
    if (!draft.docImageId || draft.docImage?.deletedAt) throw new ConflictException({ code: 'DOCUMENT_REQUIRED', message: 'Send a photo of the document first.' });

    const wording = await this.consent.approvedById(dto.consentTextId);
    if (!wording) throw new UnprocessableEntityException({ code: 'CONSENT_INVALID', message: 'The consent text is not valid.' });

    const now = new Date();
    const dob = parseIsoDate(dto.dob);
    const expiry = dto.docExpiryDate ? parseIsoDate(dto.docExpiryDate) : null;
    const field = (name: string, message: string) => ({ field: name, errors: [message] });
    const problems = [
      ...(!dob || dob > now || dob.getUTCFullYear() < 1900 ? [field('dob', 'Enter a valid date of birth.')] : []),
      ...(dto.docExpiryDate && (!expiry || expiry.getUTCFullYear() < 1990 || expiry.getUTCFullYear() > now.getUTCFullYear() + 30) ? [field('docExpiryDate', 'Enter a valid expiry date.')] : []),
    ];
    if (problems.length) throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'Request validation failed.', details: problems });

    // Which fields the guest changed compared with what was read: names of fields only, never values.
    const stored = (draft.ocrFieldsFlagged ?? {}) as { status?: string; flagged?: string[]; suggestedHashes?: Record<string, string> };
    const final: Record<string, string> = { docType: dto.docType, fullName: dto.fullName, nationality: dto.nationality, docNumber: dto.docNumber, dob: dto.dob, ...(dto.docExpiryDate ? { docExpiryDate: dto.docExpiryDate } : {}) };
    const finalHashes = suggestionHashes(final, draft.id);
    const edited = Object.entries(stored.suggestedHashes ?? {}).filter(([k, h]) => finalHashes[k] !== h).map(([k]) => k);

    let guestIndex = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        guestIndex = await db.$transaction(async (tx) => {
          // Claim a place on the link. Fails if it was revoked, expired or filled since we looked.
          const claimed = await tx.checkInLink.updateMany({
            where: { id: link.id, accountId, revokedAt: null, expiresAt: { gt: now }, guestsSubmitted: { lt: link.maxGuests } },
            data: { guestsSubmitted: { increment: 1 } },
          });
          if (claimed.count !== 1) throw linkUnavailable();
          const last = await tx.guestCheckIn.aggregate({ where: { bookingId: draft.bookingId, accountId }, _max: { guestIndex: true } });
          const index = (last._max.guestIndex ?? 0) + 1;
          const done = await tx.guestCheckIn.updateMany({
            where: { id: draft.id, accountId, linkId: link.id, status: 'PENDING' },
            data: {
              status: 'SUBMITTED',
              guestIndex: index,
              docType: dto.docType,
              fullName: dto.fullName,
              nationality: dto.nationality,
              docNumber: dto.docNumber,
              dob: dob!,
              docExpiryDate: expiry,
              declaredMoroccanNationality: dto.declaredMoroccanNationality,
              entryStampNumber: dto.entryStampNumber,
              cityOfOrigin: dto.cityOfOrigin,
              nextDestination: dto.nextDestination,
              profession: dto.profession,
              consentTextId: wording.id,
              consentAt: now,
              submittedAt: now,
              ocrFieldsFlagged: { status: stored.status ?? 'unavailable', flagged: stored.flagged ?? [], edited } as Prisma.InputJsonValue,
            },
          });
          if (done.count !== 1) throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'This form was already submitted.' });
          return index;
        });
        break;
      } catch (e) {
        // A parallel submission took the same guest number: try again with the next one.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 2) continue;
        throw e;
      }
    }

    await this.audit.record({ accountId, actorId: null, action: 'checkin.submitted', resourceType: 'GuestCheckIn', resourceId: draft.id, ip: meta.ip });
    this.fiche.generateInBackground(accountId, draft.id);
    const remaining = link.maxGuests - (link.guestsSubmitted + 1);
    return { status: 'submitted', guestIndex, remaining, canAddGuest: remaining > 0 };
  }
}
