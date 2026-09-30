import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ShareLink, ShareResourceType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { hashToken, randomToken } from '../auth/tokens';
import { WindowCounter } from '../common/window-counter';
import { RulesService } from '../compliance/rules.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MessagingService } from '../messaging/messaging.service';
import { normalizePhone } from '../messaging/phone';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterService } from '../register/register.service';
import { StorageService } from '../storage/storage.service';
import { CreateShareDto } from './dto';

export const SHARE_COUNTER = Symbol('SHARE_COUNTER');

const HOUR = 3_600_000;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
/** Unknown, malformed, expired, revoked links and links whose file is gone all get this one answer. */
const unavailable = () => new NotFoundException({ code: 'LINK_UNAVAILABLE', message: 'This link is not available.' });

/** Views of one link per window, whatever the address: a leaked link cannot be scraped at volume. */
export const LINK_VIEWS_PER_WINDOW = 20;
export const LINK_WINDOW_MS = 10 * 60_000;
const USER_AGENT_MAX = 120;

export type ShareStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export function shareStatus(link: Pick<ShareLink, 'revokedAt' | 'expiresAt'>, now = new Date()): ShareStatus {
  if (link.revokedAt) return 'REVOKED';
  if (link.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

/** Printable characters only, trimmed; stored for the manager's access log, never interpreted. */
export function trimUserAgent(ua: string | null | undefined): string {
  return (ua ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, USER_AGENT_MAX);
}

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly registers: RegisterService,
    private readonly messaging: MessagingService,
    @Inject(SHARE_COUNTER) private readonly counter: WindowCounter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The token is in the fragment: never sent to a server, a log or a link-preview bot. */
  private urlFor(token: string) {
    return `${this.config.APP_URL.replace(/\/$/, '')}/s#token=${token}`;
  }

  /** The record id a share points at, loaded through the scoped client: another account's id is not found. */
  private async resolveResource(user: AuthUser, dto: CreateShareDto): Promise<string> {
    const db = this.prisma.forAccount(user.accountId);
    if (dto.resourceType === 'FICHE_DE_POLICE') {
      const fiche = await db.ficheDePolice.findFirst({ where: { guestCheckInId: dto.guestId!, pdf: { is: { deletedAt: null } } }, select: { id: true } });
      if (!fiche) throw notFound();
      return fiche.id;
    }
    const reg = await db.policeRegister.findFirst({ where: { propertyId: dto.propertyId!, month: dto.month!, pdf: { is: { deletedAt: null } } }, select: { id: true, inputDigest: true } });
    if (!reg) throw notFound();
    // An outdated register is not sent to an authority: the manager regenerates it first.
    if (!(await this.registers.isCurrent(user.accountId, dto.propertyId!, dto.month!, reg.inputDigest))) {
      throw new ConflictException({ code: 'REGISTER_OUTDATED', message: 'The register has changed since it was generated. Generate it again before sharing it.' });
    }
    return reg.id;
  }

  async lifetime() {
    return this.rules.shareLifetime();
  }

  async create(user: AuthUser, dto: CreateShareDto, meta: ClientMeta) {
    const bounds = await this.rules.shareLifetime();
    if (dto.expiresInHours < bounds.minHours || dto.expiresInHours > bounds.maxHours) {
      throw new UnprocessableEntityException({ code: 'EXPIRY_OUT_OF_BOUNDS', message: `The link must expire between ${bounds.minHours} and ${bounds.maxHours} hours from now.` });
    }
    const phone = dto.whatsappTo === undefined ? null : normalizePhone(dto.whatsappTo);
    if (dto.whatsappTo !== undefined && !phone) throw new BadRequestException({ code: 'INVALID_PHONE', message: 'Enter the number with its country code, for example +212 6 12 34 56 78.' });
    const resourceId = await this.resolveResource(user, dto);
    const token = randomToken(); // 256 bits
    const link = await this.prisma.forAccount(user.accountId).shareLink.create({
      data: {
        accountId: user.accountId, resourceType: dto.resourceType, resourceId, tokenHash: hashToken(token), recipientLabel: dto.recipientLabel,
        expiresAt: new Date(Date.now() + dto.expiresInHours * HOUR), createdBy: user.id,
      },
    });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'share.created', resourceType: 'ShareLink', resourceId: link.id, ip: meta.ip });
    // The only time the token is ever returned.
    const url = this.urlFor(token);
    return { ...(await this.views(user.accountId, [link]))[0], token, url, delivery: await this.deliver(user, link.id, url, phone) };
  }

  /**
   * Sends the link by WhatsApp when a number was given. The label the manager typed is a private reminder and is not
   * put in the message. If WhatsApp is off, not ready or fails, the caller still has the URL to copy.
   */
  private async deliver(user: AuthUser, linkId: string, url: string, phone: string | null) {
    if (!phone) return null;
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: user.accountId }, select: { companyName: true } });
    const r = await this.messaging.send({ accountId: user.accountId, kind: 'share_link', subject: { type: 'SHARE_LINK', id: linkId }, whatsappTo: phone, variables: [account.companyName, url], actorId: user.id });
    return { channel: r.channel, status: r.status, skipped: r.skipped };
  }

  /** Never includes the token or its hash. The resource is described by ids only. */
  private async views(accountId: string, links: ShareLink[], now = new Date()) {
    const db = this.prisma.forAccount(accountId);
    const ficheIds = links.filter((l) => l.resourceType === 'FICHE_DE_POLICE').map((l) => l.resourceId);
    const registerIds = links.filter((l) => l.resourceType === 'POLICE_REGISTER').map((l) => l.resourceId);
    const [fiches, registers, last] = await Promise.all([
      ficheIds.length ? db.ficheDePolice.findMany({ where: { id: { in: ficheIds } }, select: { id: true, guestCheckInId: true } }) : [],
      registerIds.length ? db.policeRegister.findMany({ where: { id: { in: registerIds } }, select: { id: true, propertyId: true, month: true } }) : [],
      links.length ? db.shareAccess.groupBy({ by: ['shareLinkId'], where: { shareLinkId: { in: links.map((l) => l.id) } }, _max: { at: true } }) : [],
    ]);
    const fiche = new Map(fiches.map((f) => [f.id, f]));
    const register = new Map(registers.map((r) => [r.id, r]));
    const lastAt = new Map(last.map((l) => [l.shareLinkId, l._max.at]));
    return links.map((l) => ({
      id: l.id,
      resourceType: l.resourceType,
      resource:
        l.resourceType === 'FICHE_DE_POLICE'
          ? { guestId: fiche.get(l.resourceId)?.guestCheckInId ?? null }
          : { propertyId: register.get(l.resourceId)?.propertyId ?? null, month: register.get(l.resourceId)?.month ?? null },
      recipientLabel: l.recipientLabel,
      status: shareStatus(l, now),
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      viewCount: l.viewCount,
      lastAccessAt: lastAt.get(l.id) ?? null,
    }));
  }

  async list(user: AuthUser) {
    const links = await this.prisma.forAccount(user.accountId).shareLink.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return this.views(user.accountId, links);
  }

  /** Takes effect on the next request: every public read re-checks `revokedAt`. Idempotent. */
  async revoke(user: AuthUser, id: string, meta: ClientMeta): Promise<void> {
    const db = this.prisma.forAccount(user.accountId);
    const link = await db.shareLink.findFirst({ where: { id }, select: { revokedAt: true } });
    if (!link) throw notFound();
    if (link.revokedAt) return;
    await db.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'share.revoked', resourceType: 'ShareLink', resourceId: id, ip: meta.ip });
  }

  async accessLog(user: AuthUser, id: string) {
    const db = this.prisma.forAccount(user.accountId);
    if (!(await db.shareLink.findFirst({ where: { id }, select: { id: true } }))) throw notFound();
    return db.shareAccess.findMany({ where: { shareLinkId: id }, orderBy: { at: 'desc' }, select: { at: true, userAgent: true }, take: 200 });
  }

  /**
   * The public read. Runs before an account is known, so the link is found through the unscoped client by its
   * unique hash; the file is then read through the link's account. Order, fail closed:
   *   1. live link and live file, else the neutral 404;
   *   2. per-link cap;
   *   3. decrypt, with the `share.accessed` audit row written before the bytes are released (StorageService.read);
   *   4. in one transaction: re-check the link is still live (a revocation in between wins) and record the access.
   * Only then are the bytes returned. A failure at any step returns no byte.
   */
  async open(rawToken: unknown, userAgent: string | undefined): Promise<{ bytes: Buffer; type: ShareResourceType }> {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw unavailable();
    const link = await this.prisma.shareLink.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!link || shareStatus(link) !== 'ACTIVE') throw unavailable();

    const db = this.prisma.forAccount(link.accountId);
    const pdfObjectId =
      link.resourceType === 'FICHE_DE_POLICE'
        ? (await db.ficheDePolice.findFirst({ where: { id: link.resourceId, pdf: { is: { deletedAt: null } } }, select: { pdfObjectId: true } }))?.pdfObjectId
        : (await db.policeRegister.findFirst({ where: { id: link.resourceId, pdf: { is: { deletedAt: null } } }, select: { pdfObjectId: true } }))?.pdfObjectId;
    if (!pdfObjectId) throw unavailable();

    if ((await this.counter.hit(`share:${link.id}`, LINK_WINDOW_MS)) > LINK_VIEWS_PER_WINDOW) {
      throw new HttpException({ code: 'TOO_MANY_VIEWS', message: 'Too many attempts. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    let bytes: Buffer;
    try {
      ({ bytes } = await this.storage.read(link.accountId, pdfObjectId, { actorId: null, action: 'share.accessed', resourceType: 'ShareLink', resourceId: link.id }));
    } catch (e) {
      if (e instanceof NotFoundException) throw unavailable();
      throw e;
    }

    const recorded = await this.prisma.$transaction(async (tx) => {
      const live = await tx.shareLink.updateMany({ where: { id: link.id, accountId: link.accountId, revokedAt: null, expiresAt: { gt: new Date() } }, data: { viewCount: { increment: 1 } } });
      if (live.count === 0) return false;
      await tx.shareAccess.create({ data: { accountId: link.accountId, shareLinkId: link.id, userAgent: trimUserAgent(userAgent) } });
      return true;
    });
    if (!recorded) throw unavailable();
    return { bytes, type: link.resourceType };
  }
}
