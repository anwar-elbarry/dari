import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { revokeLinksTo } from '../share/revoke-links';
import { handOver, provisionalUntil } from '../storage/hand-over';
import { StorageService } from '../storage/storage.service';
import { FicheData, renderFicheHtml, TEMPLATE_VERSION } from './fiche-template';
import { PdfRenderer, PdfUnavailableError } from './pdf-renderer';

/** Parallel generations of one Fiche retry the swap this many times before giving up. */
const SWAP_ATTEMPTS = 5;
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
    private readonly audits: AuditService,
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
    // Provisional until the Fiche points at it: a crash or a lost race leaves nothing the retention job cannot reach.
    const stored = await this.storage.put(accountId, 'FICHE_PDF', pdf, { expiresAt: provisionalUntil() });

    const db = this.prisma.forAccount(accountId);
    const audit = (resourceId: string) => ({ actorId, action: 'storage.object.deleted' as const, resourceType: 'GuestCheckIn', resourceId });
    const fields = { templateVersion: TEMPLATE_VERSION, sha256, generatedAt: new Date() };
    // Compare-and-swap on the previous file, so parallel generations each release exactly the file they replaced.
    // The same transaction adopts the new file, marks the replaced one due for deletion and revokes the links to it.
    let swap: { previous: string | null; revoked: string[] } | null = null;
    try {
      for (let attempt = 0; !swap; attempt++) {
        if (attempt === SWAP_ATTEMPTS) throw new ServiceUnavailableException({ code: 'FICHE_BUSY', message: 'The Fiche is being generated. Try again.' });
        const existing = await db.ficheDePolice.findFirst({ where: { guestCheckInId: guestId }, select: { id: true, pdfObjectId: true } });
        swap = await db
          .$transaction(async (tx) => {
            if (!existing) {
              await tx.ficheDePolice.create({ data: { accountId, guestCheckInId: guestId, pdfObjectId: stored.id, ...fields } });
              await handOver(tx, stored.id, null);
              return { previous: null, revoked: [] };
            }
            const swapped = await tx.ficheDePolice.updateMany({ where: { id: existing.id, pdfObjectId: existing.pdfObjectId }, data: { pdfObjectId: stored.id, ...fields } });
            if (swapped.count === 0) return null;
            await handOver(tx, stored.id, existing.pdfObjectId);
            return { previous: existing.pdfObjectId, revoked: await revokeLinksTo(tx, 'FICHE_DE_POLICE', existing.id) };
          })
          .catch((e: unknown) => {
            // A parallel generation created it first: go round again and replace that one.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
            throw e;
          });
      }
    } catch (e) {
      await this.storage.delete(accountId, stored.id, audit(guestId)).catch(() => undefined); // if this fails too, the file is provisional
      throw e;
    }
    // Already due: if this delete fails, the retention job finishes it.
    if (swap.previous) await this.storage.delete(accountId, swap.previous, audit(guestId)).catch(() => this.logger.warn(`could not remove the previous Fiche of guest ${guestId}`));
    for (const id of swap.revoked) await this.audits.record({ accountId, actorId, action: 'share.revoked', resourceType: 'ShareLink', resourceId: id });
    return { templateVersion: TEMPLATE_VERSION, sha256, revokedShares: swap.revoked.length };
  }

  /** After submission: the guest does not wait for it, and a failure is not theirs (the manager can regenerate). */
  generateInBackground(accountId: string, guestId: string) {
    void this.generate(accountId, guestId).catch((e: unknown) => this.logger.warn(`Fiche generation failed for guest ${guestId} (${e instanceof Error ? e.name : 'error'})`));
  }

  async regenerate(user: AuthUser, guestId: string) {
    try {
      const { templateVersion, revokedShares } = await this.generate(user.accountId, guestId, user.id);
      return { templateVersion, generatedAt: new Date(), revokedShares };
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
