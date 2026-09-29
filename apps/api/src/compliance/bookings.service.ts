import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PropertyEvents } from '../common/property-events';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { countNights, dayLevel, projectedBreachDate } from './day-counter';
import { BookingsQuery, ClassifyDto } from './dto';
import { RulesService } from './rules.service';
import { CALENDAR_TZ, toCalendarDate } from '../ical/parse';

const BASE_FIELDS = {
  id: true,
  propertyId: true,
  checkIn: true,
  checkOut: true,
  source: true,
  classification: true,
  classifiedBy: true,
  status: true,
  feedId: true,
  importBatchId: true,
} as const;

const REVENUE_FIELDS = {
  partySize: true,
  nightlyRevenue: true,
  cleaningFee: true,
  addonRevenue: true,
  discounts: true,
  refunds: true,
  platformCommission: true,
  taxeSejourAmount: true,
  confirmationCode: true,
} as const;

const notFound = (what: string) => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });
const day = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly events: PropertyEvents,
  ) {}

  /** Nights that count: confirmed stays classified as bookings. Blocks and uncertain events are excluded. */
  async dayCounter(user: AuthUser, propertyId: string, year = currentYear()) {
    const db = this.prisma.forAccount(user.accountId);
    const property = await db.property.findUnique({ where: { id: propertyId }, select: { id: true, licenseStatus: true } });
    if (!property) throw notFound('Property');
    const rule = await this.rules.dayCounter();

    const stays = await db.booking.findMany({
      where: { propertyId, status: 'CONFIRMED', checkIn: { lt: new Date(`${year + 1}-01-01`) }, checkOut: { gt: new Date(`${year}-01-01`) } },
      select: { checkIn: true, checkOut: true, classification: true },
    });
    const ranges = (c: string) => stays.filter((s) => s.classification === c).map((s) => ({ checkIn: day(s.checkIn), checkOut: day(s.checkOut) }));
    const counted = ranges('BOOKING');
    const nights = countNights(counted, year);
    const today = toCalendarDate(new Date(), false);

    return {
      propertyId,
      year,
      applies: property.licenseStatus === 'UNLICENSED',
      nights,
      level: dayLevel(nights, rule),
      thresholds: { amber: rule.amber, red: rule.red, cap: rule.cap },
      period: rule.period,
      rulesValidated: rule.validated,
      projectedBreachDate: projectedBreachDate(counted, year, rule.cap),
      nightsBooked: countNights(counted.filter((r) => r.checkIn < today), year),
      pendingReview: ranges('UNCERTAIN').length,
      uncertainNights: countNights(ranges('UNCERTAIN'), year),
      ownerBlockNights: countNights(ranges('OWNER_BLOCK'), year),
      timezone: CALENDAR_TZ,
    };
  }

  async list(user: AuthUser, propertyId: string, q: BookingsQuery) {
    const db = this.prisma.forAccount(user.accountId);
    if (!(await db.property.findUnique({ where: { id: propertyId }, select: { id: true } }))) throw notFound('Property');
    const select = can(user.role, 'revenue:read') ? { ...BASE_FIELDS, ...REVENUE_FIELDS } : BASE_FIELDS;
    return db.booking.findMany({
      where: {
        propertyId,
        ...(q.to ? { checkIn: { lte: new Date(q.to) } } : {}),
        ...(q.from ? { checkOut: { gte: new Date(q.from) } } : {}),
      },
      select,
      orderBy: { checkIn: 'asc' },
      take: 2000,
    });
  }

  /** Manual decision on a stay vs block. Marked MANUAL so later syncs keep it. */
  async classify(user: AuthUser, bookingId: string, dto: ClassifyDto, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    const { count } = await db.booking.updateMany({ where: { id: bookingId }, data: { classification: dto.classification, classifiedBy: 'MANUAL' } });
    if (count === 0) throw notFound('Booking');
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'booking.classified', resourceType: 'Booking', resourceId: bookingId, ip: meta.ip });
    const updated = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: BASE_FIELDS });
    await this.events.nightsChanged(user.accountId, updated.propertyId);
    return updated;
  }
}

export function currentYear(): number {
  return Number(toCalendarDate(new Date(), false).slice(0, 4));
}
