import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { VALIDATION_FAILED } from '../common/http-exception.filter';
import { isUniqueViolation } from '../common/prisma-errors';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { publicOnly } from './address-policy';
import { CreateFeedDto, UpdateFeedDto } from './dto';
import { resolveAllowed, SafeFetchError, validateFeedUrl } from './safe-fetch';
import { SyncResult, SyncService } from './sync.service';

/** The URL is returned only here (ical:manage routes); it never reaches Staff, logs or audit rows. */
const FIELDS = { id: true, propertyId: true, platform: true, url: true, lastSyncedAt: true, lastStatus: true, lastError: true, eventCount: true, createdAt: true } as const;

const notFound = (what = 'Feed') => new NotFoundException({ code: 'NOT_FOUND', message: `${what} not found.` });

@Injectable()
export class FeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: AuthUser, propertyId: string) {
    await this.assertProperty(user, propertyId);
    return this.prisma.forAccount(user.accountId).icalFeed.findMany({ where: { propertyId }, select: FIELDS, orderBy: { platform: 'asc' } });
  }

  async create(user: AuthUser, propertyId: string, dto: CreateFeedDto, meta: ClientMeta) {
    await this.assertProperty(user, propertyId);
    const url = await this.checkUrl(dto.url);
    try {
      const feed = await this.prisma.forAccount(user.accountId).icalFeed.create({
        data: { accountId: user.accountId, propertyId, platform: dto.platform, url },
        select: FIELDS,
      });
      await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'ical_feed.created', resourceType: 'IcalFeed', resourceId: feed.id, ip: meta.ip });
      return feed;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException({ code: 'FEED_EXISTS', message: 'This property already has a calendar for that platform.' });
      throw e;
    }
  }

  async update(user: AuthUser, propertyId: string, feedId: string, dto: UpdateFeedDto, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    if (!dto.url) {
      const feed = await db.icalFeed.findFirst({ where: { id: feedId, propertyId }, select: FIELDS });
      if (!feed) throw notFound();
      return feed;
    }
    const data = { url: await this.checkUrl(dto.url), lastStatus: 'NEVER' as const, lastError: null };
    const { count } = await db.icalFeed.updateMany({ where: { id: feedId, propertyId }, data });
    if (count === 0) throw notFound();
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'ical_feed.updated', resourceType: 'IcalFeed', resourceId: feedId, ip: meta.ip });
    return db.icalFeed.findUniqueOrThrow({ where: { id: feedId }, select: FIELDS });
  }

  /** Deleting a feed keeps its bookings (feedId becomes null): past nights are a record, not a cache. */
  async remove(user: AuthUser, propertyId: string, feedId: string, meta: ClientMeta) {
    const { count } = await this.prisma.forAccount(user.accountId).icalFeed.deleteMany({ where: { id: feedId, propertyId } });
    if (count === 0) throw notFound();
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'ical_feed.deleted', resourceType: 'IcalFeed', resourceId: feedId, ip: meta.ip });
  }

  /** Runs the sync inline so the user sees the result; scheduled syncs go through the queue. */
  async syncNow(user: AuthUser, propertyId: string, feedId: string): Promise<SyncResult> {
    const feed = await this.prisma.forAccount(user.accountId).icalFeed.findFirst({ where: { id: feedId, propertyId }, select: { id: true } });
    if (!feed) throw notFound();
    return this.sync.syncFeed(feed.id);
  }

  private async assertProperty(user: AuthUser, propertyId: string) {
    const p = await this.prisma.forAccount(user.accountId).property.findUnique({ where: { id: propertyId }, select: { id: true } });
    if (!p) throw notFound('Property');
  }

  /** Same checks as the fetcher (scheme, credentials, resolved addresses) so a bad link is refused when pasted. */
  private async checkUrl(raw: string): Promise<string> {
    try {
      const url = validateFeedUrl(raw, this.config.ICAL_ALLOW_INSECURE);
      await resolveAllowed(url.hostname, this.config.ICAL_ALLOW_INSECURE ? () => true : publicOnly);
      return url.toString();
    } catch (e) {
      if (e instanceof SafeFetchError) {
        throw new BadRequestException({ code: VALIDATION_FAILED, message: 'Request validation failed.', details: [{ field: 'url', errors: [e.message] }] });
      }
      throw e;
    }
  }
}
