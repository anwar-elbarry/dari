import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { RulesService } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StorageAudit, StorageService } from '../storage/storage.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A draft (photo sent, form never submitted) is removed after this long: an abandoned passport photo must not linger. */
export const DRAFT_TTL_MS = 24 * HOUR;
/** A purge that is more than this late is an alert: it means the job is failing. */
export const OVERDUE_AFTER_MS = 24 * HOUR;
const BATCH = 200;

export interface PurgeResult {
  /** Stored objects deleted in this run. */
  purged: number;
  /** Abandoned drafts removed. */
  drafts: number;
  /** Deletions that failed (the object is retried on the next run). */
  failed: number;
  /** Objects more than a day past their purge date after this run. */
  overdue: number;
}

/** The latest month (YYYY-MM) that had fully ended by `cutoff`, i.e. whose last day is on or before it. */
export function lastFullMonthBefore(cutoff: Date): string {
  const nextDay = new Date(cutoff.getTime() + DAY);
  const endsToday = nextDay.getUTCDate() === 1; // the cutoff is the last day of its month
  const d = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() - (endsToday ? 0 : 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const purgeAudit = (resourceType: string, resourceId: string): StorageAudit => ({ actorId: null, action: 'retention.purged', resourceType, resourceId });

/**
 * Deletes what must not be kept: ID images after the retention window, abandoned drafts after a day, and any
 * object past its own purge date. Structured guest records are kept; Fiche PDFs and registers are kept until counsel sets and validates a period. Every deletion is audited
 * (`retention.purged`, identifiers only). Safe to run at any time and as often as wanted: a second run finds
 * nothing to do. A failure on one object never stops the others; it is retried on the next run and reported.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rules: RulesService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `now` is a parameter so tests can move time. */
  async purge(now = new Date()): Promise<PurgeResult> {
    const result: PurgeResult = { purged: 0, drafts: 0, failed: 0, overdue: 0 };

    // 1. Abandoned drafts. The row goes first, and only while it is still PENDING: a guest who submits at this very
    // moment wins (nothing is deleted), and a photo whose removal fails below keeps its one-day expiry, so step 2 finds it.
    await this.sweep(
      (skip) =>
        this.prisma.guestCheckIn.findMany({
          where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_MS) } },
          select: { id: true, accountId: true, docImageId: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          skip,
        }),
      async (d) => {
        const claimed = await this.prisma.guestCheckIn.deleteMany({ where: { id: d.id, status: 'PENDING' } });
        if (claimed.count === 0) return false; // submitted meanwhile: left alone (and skipped, it is no longer a draft)
        result.drafts += 1;
        if (d.docImageId) await this.remove(d.accountId, d.docImageId, purgeAudit('GuestCheckIn', d.id), result);
        return true;
      },
    );

    // 2. Objects past their own purge date, and 4. half-finished deletions (key shredded, bucket delete failed).
    await this.sweep(
      (skip) =>
        this.prisma.storedObject.findMany({
          where: { deletedAt: null, OR: [{ expiresAt: { lte: now } }, { wrappedKey: '' }] },
          select: { id: true, accountId: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          skip,
        }),
      (o) => this.remove(o.accountId, o.id, purgeAudit('StoredObject', o.id), result),
    );

    // 3. ID images past the CURRENT retention rule (shortening the rule applies to images already stored).
    const { days } = await this.rules.idRetention();
    await this.sweep(
      (skip) =>
        this.prisma.guestCheckIn.findMany({
          where: { docImage: { is: { deletedAt: null, kind: 'ID_IMAGE' } }, booking: { checkOut: { lte: new Date(now.getTime() - days * DAY) } } },
          select: { id: true, docImageId: true, accountId: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          skip,
        }),
      (g) => (g.docImageId ? this.remove(g.accountId, g.docImageId, purgeAudit('StoredObject', g.docImageId), result) : Promise.resolve(true)),
    );

    // 5. Fiche PDFs past the rule, once counsel has set and validated a period (no period: kept).
    const fiche = (await this.rules.ficheRetention()).enforceable;
    const purgedFiches: { accountId: string; id: string }[] = [];
    if (fiche !== null) {
      await this.sweep(
        (skip) =>
          this.prisma.ficheDePolice.findMany({
            where: { pdf: { is: { deletedAt: null } }, guestCheckIn: { is: { booking: { checkOut: { lte: new Date(now.getTime() - fiche * DAY) } } } } },
            select: { id: true, pdfObjectId: true, accountId: true },
            orderBy: { id: 'asc' },
            take: BATCH,
            skip,
          }),
        async (f) => {
          if (!(await this.remove(f.accountId, f.pdfObjectId, purgeAudit('StoredObject', f.pdfObjectId), result))) return false;
          purgedFiches.push({ accountId: f.accountId, id: f.id });
          return true;
        },
      );
    }

    // 5b. A share link must not outlive its file: revoke the links that pointed at a purged Fiche.
    const deletedFiches = await this.prisma.ficheDePolice.findMany({ where: { id: { in: purgedFiches.map((f) => f.id) }, pdf: { is: { deletedAt: { not: null } } } }, select: { id: true, accountId: true } });
    await this.revokeShares('FICHE_DE_POLICE', deletedFiches, now);

    // 6. Monthly registers past the rule (counted from the last day of the month), once counsel has validated a period.
    await this.purgeRegisters(now, result);

    // 7. Licence documents past the rule (counted from the upload), once counsel has validated a period.
    await this.purgeLicenseDocuments(now, result);

    result.overdue = await this.prisma.storedObject.count({ where: { deletedAt: null, expiresAt: { lte: new Date(now.getTime() - OVERDUE_AFTER_MS) } } });
    if (result.failed > 0 || result.overdue > 0) await this.alert(result);
    return result;
  }

  /** The checklist item stays; it just loses its document. */
  private async purgeLicenseDocuments(now: Date, result: PurgeResult) {
    const days = (await this.rules.licenseDocumentRetention()).enforceable;
    if (days === null) return;
    await this.sweep(
      (skip) =>
        this.prisma.checklistItem.findMany({
          where: { document: { is: { deletedAt: null, createdAt: { lte: new Date(now.getTime() - days * DAY) } } } },
          select: { id: true, accountId: true, documentObjectId: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          skip,
        }),
      async (item) => {
        if (!item.documentObjectId || !(await this.remove(item.accountId, item.documentObjectId, purgeAudit('ChecklistItem', item.id), result))) return false;
        await this.prisma.checklistItem.updateMany({ where: { id: item.id, documentObjectId: item.documentObjectId }, data: { documentObjectId: null } });
        return true;
      },
    );
  }

  /**
   * Works through what is due a page at a time. A row that could not be purged stays in the result set, so the next
   * page skips past it: rows that keep failing (a store outage) cannot hide the rows behind them.
   */
  private async sweep<T>(page: (skip: number) => Promise<T[]>, handle: (row: T) => Promise<boolean>) {
    let skip = 0;
    for (let i = 0; i < 5; i++) {
      const rows = await page(skip);
      if (rows.length === 0) return;
      for (const row of rows) if (!(await handle(row))) skip += 1;
      if (rows.length < BATCH) return;
    }
  }

  /** The register row goes with its PDF: a month without a file reads as "no register" and can be generated again. */
  private async purgeRegisters(now: Date, result: PurgeResult) {
    const days = (await this.rules.policeRegisterRetention()).enforceable;
    if (days === null) return;
    await this.sweep(
      (skip) =>
        this.prisma.policeRegister.findMany({
          where: { month: { lte: lastFullMonthBefore(new Date(now.getTime() - days * DAY)) }, pdf: { is: { deletedAt: null } } },
          select: { id: true, accountId: true, pdfObjectId: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          skip,
        }),
      async (r) => {
        if (!(await this.remove(r.accountId, r.pdfObjectId, purgeAudit('PoliceRegister', r.id), result))) return false;
        await this.revokeShares('POLICE_REGISTER', [r], now);
        await this.prisma.policeRegister.deleteMany({ where: { id: r.id } });
        return true;
      },
    );
  }

  /** Revokes the live share links of purged records, each audited (`share.revoked`, no actor). */
  private async revokeShares(resourceType: 'FICHE_DE_POLICE' | 'POLICE_REGISTER', records: { id: string; accountId: string }[], now: Date) {
    if (records.length === 0) return;
    const links = await this.prisma.shareLink.findMany({ where: { resourceType, resourceId: { in: records.map((r) => r.id) }, revokedAt: null }, select: { id: true, accountId: true } });
    for (const l of links) {
      await this.prisma.shareLink.updateMany({ where: { id: l.id, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.record({ accountId: l.accountId, actorId: null, action: 'share.revoked', resourceType: 'ShareLink', resourceId: l.id });
    }
  }

  private async remove(accountId: string, objectId: string, audit: StorageAudit, result: PurgeResult): Promise<boolean> {
    try {
      if (await this.storage.delete(accountId, objectId, audit)) result.purged += 1;
      return true;
    } catch (e) {
      result.failed += 1;
      this.logger.error(`could not purge object ${objectId} (${e instanceof Error ? e.name : 'error'})`); // ids only
      return false;
    }
  }

  /** Counts only: no identifiers of people, no content. */
  private async alert(r: PurgeResult) {
    this.logger.error(`Retention needs attention: ${r.failed} failed, ${r.overdue} overdue`);
    if (!this.config.OPS_ALERT_EMAIL) return;
    await this.mail
      .send({
        to: this.config.OPS_ALERT_EMAIL,
        subject: 'Dari: retention job needs attention',
        text: `The retention job failed to purge ${r.failed} object(s) and ${r.overdue} object(s) are more than a day past their purge date.\nThe job retries every hour. Check the API logs (search "Retention") and the storage service.\n`,
      })
      .catch(() => this.logger.error('could not send the retention alert'));
  }
}
