import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { BookingsService, currentYear } from '../compliance/bookings.service';
import { toCalendarDate } from '../ical/parse';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { activity } from './activity';
import { AlertsService } from './alerts.service';

/** Days ahead counted as upcoming arrivals on the home screen (a display choice, not a rule). */
export const ARRIVALS_WINDOW_DAYS = 7;

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000);

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Property cards with their counters, the open alerts and the year's activity (counted nights per month and per
   * platform, arrivals in the next days). Staff see no owner or tax data (reduced projection); night counts are not
   * financial data, so they get the activity too.
   */
  async get(user: AuthUser, year = currentYear()) {
    const full = can(user.role, 'property:read_full');
    const properties = await this.prisma.forAccount(user.accountId).property.findMany({
      select: { id: true, name: true, commune: true, licenseStatus: true, licenseType: true, ...(full ? { taxRegime: true } : {}) },
      orderBy: { name: 'asc' },
    });
    const cards = await Promise.all(
      properties.map(async (p) => {
        const c = await this.bookings.dayCounter(user, p.id, year);
        const feeds = can(user.role, 'ical:manage') ? await this.prisma.forAccount(user.accountId).icalFeed.findMany({ where: { propertyId: p.id }, select: { lastStatus: true } }) : [];
        return {
          ...p,
          counter: { applies: c.applies, nights: c.nights, level: c.level, projectedBreachDate: c.projectedBreachDate, pendingReview: c.pendingReview },
          ...(can(user.role, 'ical:manage') ? { feedProblems: feeds.filter((f) => f.lastStatus === 'ERROR').length } : {}),
        };
      }),
    );
    const open = await this.alerts.list(user, { open: true });
    const db = this.prisma.forAccount(user.accountId);
    const counted = { status: 'CONFIRMED', classification: 'BOOKING' } as const;
    const stays = await db.booking.findMany({
      where: { ...counted, checkIn: { lt: new Date(`${year + 1}-01-01`) }, checkOut: { gt: new Date(`${year}-01-01`) } },
      select: { propertyId: true, checkIn: true, checkOut: true, source: true },
    });
    const today = toCalendarDate(new Date(), false);
    const upcomingArrivals = await db.booking.count({ where: { ...counted, checkIn: { gte: addDays(today, 0), lt: addDays(today, ARRIVALS_WINDOW_DAYS) } } });
    const first = cards[0];
    const sample = first ? await this.bookings.dayCounter(user, first.id, year) : null;
    return {
      year,
      thresholds: sample?.thresholds ?? null,
      rulesValidated: sample?.rulesValidated ?? false,
      totals: { properties: cards.length, atRisk: cards.filter((c) => c.counter.applies && c.counter.level !== 'green').length, pendingReview: cards.reduce((n, c) => n + c.counter.pendingReview, 0) },
      properties: cards,
      alerts: open,
      activity: {
        ...activity(
          stays.map((s) => ({ propertyId: s.propertyId, checkIn: s.checkIn.toISOString().slice(0, 10), checkOut: s.checkOut.toISOString().slice(0, 10), source: s.source })),
          year,
        ),
        upcomingArrivals,
        upcomingDays: ARRIVALS_WINDOW_DAYS,
      },
    };
  }
}
