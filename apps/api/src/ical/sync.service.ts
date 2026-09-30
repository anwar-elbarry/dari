import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookingClassification, BookingStatus, IcalFeed, Prisma } from '@prisma/client';
import { PropertyEvents } from '../common/property-events';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { classify, storableSummary } from './classify';
import { CalendarEvent, MAX_EVENTS, parseIcs, toCalendarDate } from './parse';
import { safeFetch, SafeFetchError } from './safe-fetch';
import { describeUnexpected } from '../common/http-exception.filter';

export interface SyncResult {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  cancelled: number;
  skipped: number;
}

/**
 * Pulls one feed and reconciles its bookings:
 * - events are upserted by (feedId, uid); a manual classification is never overwritten by a sync;
 * - a future event missing from the feed is cancelled;
 * - a past stay (checkout before today) is frozen: never cancelled or deleted because it disappeared,
 *   since platforms trim old events from their exports;
 * - on any error the previous bookings stay and the feed records a sanitised status.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('IcalSync');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PropertyEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Internal: called by the queue or by "sync now" after the caller checked the feed belongs to the account. */
  async syncFeed(feedId: string): Promise<SyncResult> {
    const feed = await this.prisma.icalFeed.findUnique({ where: { id: feedId } });
    if (!feed) return { ok: false, error: 'Feed not found.', created: 0, updated: 0, cancelled: 0, skipped: 0 };

    let events: CalendarEvent[];
    let skipped: number;
    try {
      const res = await safeFetch(feed.url, {
        timeoutMs: this.config.ICAL_FETCH_TIMEOUT_MS,
        maxBytes: this.config.ICAL_MAX_BYTES,
        allowHttp: this.config.ICAL_ALLOW_INSECURE,
        policy: this.config.ICAL_ALLOW_INSECURE ? () => true : undefined,
      });
      ({ events, skipped } = parseIcs(res.body));
      if (events.length === 0 && !/BEGIN:VCALENDAR/i.test(res.body)) throw new SafeFetchError('HTTP_ERROR', 'The link does not point to a calendar file.');
      if (events.length > MAX_EVENTS) throw new SafeFetchError('TOO_LARGE', 'The calendar has too many events.');
    } catch (e) {
      const message = e instanceof SafeFetchError ? e.message : 'The calendar could not be read.';
      if (!(e instanceof SafeFetchError)) this.logger.warn(`feed ${feed.id}: ${describeUnexpected(e, false)}`);
      await this.prisma.icalFeed.update({ where: { id: feed.id }, data: { lastStatus: 'ERROR', lastError: message, lastSyncedAt: new Date() } });
      return { ok: false, error: message, created: 0, updated: 0, cancelled: 0, skipped: 0 };
    }

    let result: { created: number; updated: number; cancelled: number };
    try {
      result = await this.reconcile(feed, events);
    } catch (e) {
      // A database problem must not leave the feed looking healthy: record it and keep the previous bookings.
      this.logger.error(`feed ${feed.id}: reconcile failed: ${describeUnexpected(e, false)}`);
      const message = 'The calendar could not be saved. Try again in a few minutes.';
      await this.prisma.icalFeed.update({ where: { id: feed.id }, data: { lastStatus: 'ERROR', lastError: message, lastSyncedAt: new Date() } }).catch(() => undefined);
      return { ok: false, error: message, created: 0, updated: 0, cancelled: 0, skipped: 0 };
    }
    if (result.created || result.updated || result.cancelled) await this.events.nightsChanged(feed.accountId, feed.propertyId);
    await this.prisma.icalFeed.update({
      where: { id: feed.id },
      data: { lastStatus: 'OK', lastError: null, lastSyncedAt: new Date(), eventCount: events.length },
    });
    return { ok: true, ...result, skipped };
  }

  private async reconcile(feed: IcalFeed, events: CalendarEvent[]) {
    const today = toCalendarDate(new Date(), false);
    const byUid = new Map(events.map((e) => [e.uid, e])); // last occurrence of a duplicated UID wins
    let created = 0;
    let updated = 0;
    let cancelled = 0;

    await this.prisma.$transaction(
      async (tx) => {
        // One sync per feed at a time (queue and "sync now" can overlap): later callers wait, then see the result.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${feed.id}))`;
        const existing = await tx.booking.findMany({ where: { feedId: feed.id } });
        const existingByUid = new Map(existing.map((b) => [b.externalUid!, b]));
        const toCreate: Prisma.BookingCreateManyInput[] = [];

        for (const ev of byUid.values()) {
          const { classification } = classify(feed.platform, ev.summary);
          const status: BookingStatus = ev.cancelled ? 'CANCELLED' : 'CONFIRMED';
          const summary = storableSummary(feed.platform, ev.summary);
          const row = existingByUid.get(ev.uid);
          if (!row) {
            toCreate.push({
              accountId: feed.accountId,
              propertyId: feed.propertyId,
              feedId: feed.id,
              externalUid: ev.uid,
              checkIn: new Date(ev.start),
              checkOut: new Date(ev.end),
              source: feed.platform,
              summary,
              classification,
              classifiedBy: 'AUTO',
              status,
              cancelledAt: ev.cancelled ? new Date() : null,
            });
            continue;
          }
          const next: { checkIn: Date; checkOut: Date; summary: string | null; status: BookingStatus; cancelledAt: Date | null; classification?: BookingClassification } = {
            checkIn: new Date(ev.start),
            checkOut: new Date(ev.end),
            summary,
            status,
            cancelledAt: status === 'CANCELLED' ? (row.cancelledAt ?? new Date()) : null,
          };
          if (row.classifiedBy === 'AUTO') next.classification = classification;
          const changed =
            row.checkIn.toISOString().slice(0, 10) !== ev.start ||
            row.checkOut.toISOString().slice(0, 10) !== ev.end ||
            row.summary !== summary ||
            row.status !== status ||
            (next.classification !== undefined && row.classification !== next.classification);
          if (changed) {
            await tx.booking.update({ where: { id: row.id }, data: next });
            updated++;
          }
        }

        if (toCreate.length) {
          await tx.booking.createMany({ data: toCreate, skipDuplicates: true });
          created = toCreate.length;
        }

        const gone = existing.filter((row) => !byUid.has(row.externalUid!) && row.status === 'CONFIRMED' && row.checkOut.toISOString().slice(0, 10) > today);
        if (gone.length) {
          await tx.booking.updateMany({ where: { id: { in: gone.map((r) => r.id) } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
          cancelled = gone.length;
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    return { created, updated, cancelled };
  }
}
