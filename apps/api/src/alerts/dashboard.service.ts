import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { BookingsService, currentYear } from '../compliance/bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { AlertsService } from './alerts.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly alerts: AlertsService,
  ) {}

  /** Property cards with their counters and the open alerts. Staff see no owner or tax data (reduced projection). */
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
    const first = cards[0];
    const sample = first ? await this.bookings.dayCounter(user, first.id, year) : null;
    return {
      year,
      thresholds: sample?.thresholds ?? null,
      rulesValidated: sample?.rulesValidated ?? false,
      totals: { properties: cards.length, atRisk: cards.filter((c) => c.counter.applies && c.counter.level !== 'green').length, pendingReview: cards.reduce((n, c) => n + c.counter.pendingReview, 0) },
      properties: cards,
      alerts: open,
    };
  }
}
