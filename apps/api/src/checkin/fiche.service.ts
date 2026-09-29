import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FicheData, renderFicheHtml, TEMPLATE_VERSION } from './fiche-template';
import { PdfRenderer, PdfUnavailableError } from './pdf-renderer';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

/**
 * The Fiche de Police PDF of one guest. Generated after a guest submits and whenever the manager asks
 * (after a correction). The PDF is an encrypted StoredObject; reading it is audited like an ID image.
 * No retention date is set: how long the Fiche is kept is an open decision for counsel (docs/phase-3.md).
 */
@Injectable()
export class FicheService {
  private readonly logger = new Logger('Fiche');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: PdfRenderer,
  ) {}

  private async load(accountId: string, guestId: string) {
    const guest = await this.prisma.forAccount(accountId).guestCheckIn.findFirst({
      where: { id: guestId, status: { in: ['SUBMITTED', 'VERIFIED'] } },
      include: { booking: { select: { checkIn: true, checkOut: true, property: { select: { name: true, address: true, commune: true } } } }, consentText: { select: { version: true, locale: true } } },
    });
    if (!guest) throw notFound();
    return guest;
  }

  /** Renders, encrypts and stores the PDF; replaces (and deletes) the previous one. */
  async generate(accountId: string, guestId: string, actorId: string | null = null) {
    const g = await this.load(accountId, guestId);
    const data: FicheData = {
      property: g.booking.property,
      stay: { checkIn: g.booking.checkIn, checkOut: g.booking.checkOut },
      guest: g,
      consent: g.consentText && g.consentAt ? { ...g.consentText, at: g.consentAt } : null,
      generatedAt: new Date(),
    };
    const pdf = await this.renderer.render(renderFicheHtml(data));
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const stored = await this.storage.put(accountId, 'FICHE_PDF', pdf);

    const db = this.prisma.forAccount(accountId);
    const audit = (resourceId: string) => ({ actorId, action: 'storage.object.deleted' as const, resourceType: 'GuestCheckIn', resourceId });
    let existing = await db.ficheDePolice.findFirst({ where: { guestCheckInId: guestId } });
    if (!existing) {
      try {
        await db.ficheDePolice.create({ data: { accountId, guestCheckInId: guestId, pdfObjectId: stored.id, templateVersion: TEMPLATE_VERSION, sha256 } });
        return { templateVersion: TEMPLATE_VERSION, sha256 };
      } catch (e) {
        // A parallel generation created it first: fall through and replace that one.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
          await this.storage.delete(accountId, stored.id, audit(guestId)).catch(() => undefined);
          throw e;
        }
        existing = await db.ficheDePolice.findFirst({ where: { guestCheckInId: guestId } });
      }
    }
    const previous = existing!.pdfObjectId;
    await db.ficheDePolice.update({ where: { id: existing!.id }, data: { pdfObjectId: stored.id, templateVersion: TEMPLATE_VERSION, sha256, generatedAt: new Date() } });
    await this.storage.delete(accountId, previous, audit(guestId)).catch(() => this.logger.warn(`could not remove the previous Fiche of guest ${guestId}`));
    return { templateVersion: TEMPLATE_VERSION, sha256 };
  }

  /** After submission: the guest does not wait for it, and a failure is not theirs (the manager can regenerate). */
  generateInBackground(accountId: string, guestId: string) {
    void this.generate(accountId, guestId).catch((e: unknown) => this.logger.warn(`Fiche generation failed for guest ${guestId} (${e instanceof Error ? e.name : 'error'})`));
  }

  async regenerate(user: AuthUser, guestId: string) {
    try {
      const { templateVersion } = await this.generate(user.accountId, guestId, user.id);
      return { templateVersion, generatedAt: new Date() };
    } catch (e) {
      if (e instanceof PdfUnavailableError) throw new ServiceUnavailableException({ code: 'PDF_UNAVAILABLE', message: 'The PDF could not be generated. Try again later.' });
      throw e;
    }
  }

  /** The PDF, decrypted in memory. The read is written to the audit trail before any byte is returned. */
  async read(user: AuthUser, guestId: string, meta: ClientMeta): Promise<Buffer> {
    const fiche = await this.prisma.forAccount(user.accountId).ficheDePolice.findFirst({ where: { guestCheckInId: guestId } });
    if (!fiche) throw notFound();
    const { bytes } = await this.storage.read(user.accountId, fiche.pdfObjectId, { actorId: user.id, action: 'guest.fiche.read', resourceType: 'GuestCheckIn', resourceId: guestId, ip: meta.ip });
    return bytes;
  }
}
