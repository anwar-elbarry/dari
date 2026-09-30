import { Inject, Injectable, Logger } from '@nestjs/common';
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `now` is a parameter so tests can move time. */
  async purge(now = new Date()): Promise<PurgeResult> {
    const result: PurgeResult = { purged: 0, drafts: 0, failed: 0, overdue: 0 };

    // 1. Abandoned drafts: the photo, then the row (nothing personal is in a draft besides the photo).
    const drafts = await this.prisma.guestCheckIn.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_MS) } },
      select: { id: true, accountId: true, docImage: { select: { id: true, deletedAt: true } } },
      take: BATCH,
    });
    for (const d of drafts) {
      if (d.docImage && !d.docImage.deletedAt && !(await this.remove(d.accountId, d.docImage.id, purgeAudit('GuestCheckIn', d.id), result))) continue;
      await this.prisma.guestCheckIn.deleteMany({ where: { id: d.id, status: 'PENDING' } });
      result.drafts += 1;
    }

    // 2. Objects past their own purge date, and 4. half-finished deletions (key shredded, bucket delete failed).
    const due = await this.prisma.storedObject.findMany({
      where: { deletedAt: null, OR: [{ expiresAt: { lte: now } }, { wrappedKey: '' }] },
      select: { id: true, accountId: true },
      orderBy: { expiresAt: 'asc' },
      take: BATCH,
    });
    // 3. ID images past the CURRENT retention rule (shortening the rule applies to images already stored).
    const { days } = await this.rules.idRetention();
    const byRule = await this.prisma.guestCheckIn.findMany({
      where: { docImage: { is: { deletedAt: null, kind: 'ID_IMAGE' } }, booking: { checkOut: { lte: new Date(now.getTime() - days * DAY) } } },
      select: { docImageId: true, accountId: true },
      take: BATCH,
    });
    // 5. Fiche PDFs past the rule, once counsel has set and validated a period (no period: kept).
    const fiche = (await this.rules.ficheRetention()).enforceable;
    const ficheDue =
      fiche === null
        ? []
        : await this.prisma.ficheDePolice.findMany({
            where: { pdf: { is: { deletedAt: null } }, guestCheckIn: { is: { booking: { checkOut: { lte: new Date(now.getTime() - fiche * DAY) } } } } },
            select: { pdfObjectId: true, accountId: true },
            take: BATCH,
          });
    const targets = new Map<string, string>();
    for (const o of due) targets.set(o.id, o.accountId);
    for (const f of ficheDue) targets.set(f.pdfObjectId, f.accountId);
    for (const g of byRule) if (g.docImageId) targets.set(g.docImageId, g.accountId);

    for (const [id, accountId] of targets) await this.remove(accountId, id, purgeAudit('StoredObject', id), result);

    // 6. Monthly registers past the rule (counted from the last day of the month), once counsel has validated a period.
    await this.purgeRegisters(now, result);

    result.overdue = await this.prisma.storedObject.count({ where: { deletedAt: null, expiresAt: { lte: new Date(now.getTime() - OVERDUE_AFTER_MS) } } });
    if (result.failed > 0 || result.overdue > 0) await this.alert(result);
    return result;
  }

  /** The register row goes with its PDF: a month without a file reads as "no register" and can be generated again. */
  private async purgeRegisters(now: Date, result: PurgeResult) {
    const days = (await this.rules.policeRegisterRetention()).enforceable;
    if (days === null) return;
    const due = await this.prisma.policeRegister.findMany({
      where: { month: { lte: lastFullMonthBefore(new Date(now.getTime() - days * DAY)) }, pdf: { is: { deletedAt: null } } },
      select: { id: true, accountId: true, pdfObjectId: true },
      take: BATCH,
    });
    for (const r of due) {
      if (await this.remove(r.accountId, r.pdfObjectId, purgeAudit('PoliceRegister', r.id), result)) await this.prisma.policeRegister.deleteMany({ where: { id: r.id } });
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
