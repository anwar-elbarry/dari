import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookingClassification, BookingStatus, IcalFeed } from '@prisma/client';
import { PropertyEvents } from '../common/property-events';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { classify, storableSummary } from './classify';
import { CalendarEvent, parseIcs, toCalendarDate } from './parse';
import { safeFetch, SafeFetchError } from './safe-fetch';

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
    } catch (e) {
      const message = e instanceof SafeFetchError ? e.message : 'The calendar could not be read.';
      if (!(e instanceof SafeFetchError)) this.logger.warn(`feed ${feed.id}: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.icalFeed.update({ where: { id: feed.id }, data: { lastStatus: 'ERROR', lastError: message, lastSyncedAt: new Date() } });
      return { ok: false, error: message, created: 0, updated: 0, cancelled: 0, skipped: 0 };
    }

    const result = await this.reconcile(feed, events);
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
    const existing = await this.prisma.booking.findMany({ where: { feedId: feed.id } });
    const existingByUid = new Map(existing.map((b) => [b.externalUid!, b]));
    let created = 0;
    let updated = 0;
    let cancelled = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const ev of byUid.values()) {
        const { classification } = classify(feed.platform, ev.summary);
        const status: BookingStatus = ev.cancelled ? 'CANCELLED' : 'CONFIRMED';
        const summary = storableSummary(feed.platform, ev.summary);
        const row = existingByUid.get(ev.uid);
        if (!row) {
          await tx.booking.create({
            data: {
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
            },
          });
          created++;
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

      for (const row of existing) {
        if (byUid.has(row.externalUid!) || row.status !== 'CONFIRMED') continue;
        const checkOut = row.checkOut.toISOString().slice(0, 10);
        if (checkOut <= today) continue; // frozen past
        await tx.booking.update({ where: { id: row.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
        cancelled++;
      }
    });

    return { created, updated, cancelled };
  }
}
