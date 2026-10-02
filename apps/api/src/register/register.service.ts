import { Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PdfRenderer, PdfUnavailableError } from '../checkin/pdf-renderer';
import { RulesService } from '../compliance/rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { revokeLinksTo } from '../share/revoke-links';
import { handOver, provisionalUntil } from '../storage/hand-over';
import { StorageService } from '../storage/storage.service';
import { buildRegister, Problem, RegisterGuest, RegisterStay, Summary } from './register-build';
import { lastMonths, monthOf, parseMonth } from './register-month';
import { REGISTER_TEMPLATE_VERSION, renderRegisterHtml } from './register-template';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

/** Months shown in the list, ending with the current one (a month with a register or a stay outside the window is shown too). */
export const LIST_MONTHS = 24;
/** A register this large is refused rather than rendered: it would tie up the shared Chromium. */
const MAX_STAYS = 500;
const MAX_ROWS = 1500;
/** Parallel generations of one month retry the swap this many times before giving up. */
const SWAP_ATTEMPTS = 5;

const GUEST_SELECT = {
  id: true, status: true, guestIndex: true, docType: true, fullName: true, nationality: true, docNumber: true, dob: true, declaredMoroccanNationality: true,
  entryStampNumber: true, cityOfOrigin: true, nextDestination: true, profession: true,
} satisfies Prisma.GuestCheckInSelect;
const STAY_SELECT = { id: true, checkIn: true, checkOut: true, partySize: true, checkIns: { select: GUEST_SELECT } } satisfies Prisma.BookingSelect;

/** Only confirmed stays that count as bookings: cancelled ones and owner blocks are not guests' stays. */
const COUNTED = { status: 'CONFIRMED', classification: 'BOOKING' } as const;

type StayRow = Prisma.BookingGetPayload<{ select: typeof STAY_SELECT }>;
const toStay = ({ checkIns, ...s }: StayRow): RegisterStay => ({ ...s, guests: checkIns as RegisterGuest[] });

export type RegisterStatus = 'none' | 'generated' | 'outdated';

@Injectable()
export class RegisterService {
  private readonly logger = new Logger('Register');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: PdfRenderer,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
  ) {}

  private async property(accountId: string, propertyId: string) {
    const property = await this.prisma.forAccount(accountId).property.findFirst({ where: { id: propertyId }, select: { id: true, name: true, address: true, commune: true } });
    if (!property) throw notFound();
    return property;
  }

  private async stays(accountId: string, propertyId: string, month: string): Promise<RegisterStay[]> {
    const bounds = parseMonth(month)!;
    const rows = await this.prisma.forAccount(accountId).booking.findMany({
      where: { propertyId, ...COUNTED, checkIn: { gte: bounds.start, lt: bounds.end } },
      select: STAY_SELECT,
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
      take: MAX_STAYS + 1,
    });
    if (rows.length > MAX_STAYS) throw new UnprocessableEntityException({ code: 'REGISTER_TOO_LARGE', message: 'Too many stays in this month to generate a register.' });
    return rows.map(toStay);
  }

  /** A month that has not started has no register to build. */
  private assertStarted(month: string, now = new Date()) {
    if (parseMonth(month)!.start.getTime() > now.getTime()) throw new UnprocessableEntityException({ code: 'MONTH_NOT_STARTED', message: 'This month has not started yet.' });
  }

  private async build(accountId: string, propertyId: string, month: string) {
    const property = await this.property(accountId, propertyId);
    const stays = await this.stays(accountId, propertyId, month);
    const { enforceable } = await this.rules.entryStampExemption();
    return { property, stays, built: buildRegister(stays, property, parseMonth(month)!.end, enforceable) };
  }

  /** Months with their status. Owner/Manager also get the counts of incomplete records; Staff get the status only. */
  async list(user: AuthUser, propertyId: string, now = new Date()) {
    const db = this.prisma.forAccount(user.accountId);
    const property = await this.property(user.accountId, propertyId);
    const detailed = can(user.role, 'register:read');
    const { enforceable } = await this.rules.entryStampExemption();

    const window = lastMonths(now, LIST_MONTHS);
    const registers = await db.policeRegister.findMany({ where: { propertyId }, select: { month: true, inputDigest: true, generatedAt: true, guestCount: true } });
    const byMonth = new Map(registers.map((r) => [r.month, r]));

    const windowStays = await db.booking.findMany({
      where: { propertyId, ...COUNTED, checkIn: { gte: parseMonth(window[0])!.start, lt: parseMonth(window[window.length - 1])!.end } },
      select: STAY_SELECT,
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
      take: MAX_STAYS * LIST_MONTHS,
    });
    const grouped = new Map<string, RegisterStay[]>();
    for (const s of windowStays) grouped.set(monthOf(s.checkIn), [...(grouped.get(monthOf(s.checkIn)) ?? []), toStay(s)]);

    const months = [...new Set([...grouped.keys(), ...byMonth.keys()])].sort().reverse();
    const out = [];
    for (const month of months) {
      // A month outside the window that is too large to load is shown as outdated rather than failing the whole list.
      const stays = grouped.get(month) ?? (byMonth.has(month) ? await this.stays(user.accountId, propertyId, month).catch(() => null) : []);
      if (stays === null) {
        out.push(detailed ? { month, status: 'outdated' as RegisterStatus, generatedAt: byMonth.get(month)!.generatedAt } : { month, status: 'outdated' as RegisterStatus });
        continue;
      }
      const built = buildRegister(stays, property, parseMonth(month)!.end, enforceable);
      const reg = byMonth.get(month);
      const status: RegisterStatus = !reg ? 'none' : reg.inputDigest === built.digest ? 'generated' : 'outdated';
      out.push(detailed ? { month, status, generatedAt: reg?.generatedAt ?? null, ...built.summary } : { month, status });
    }
    return { months: out };
  }

  /** Whether a generated register still matches the data (used before sharing it). */
  async isCurrent(accountId: string, propertyId: string, month: string, inputDigest: string): Promise<boolean> {
    const { built } = await this.build(accountId, propertyId, month);
    return built.digest === inputDigest;
  }

  /** `stays` carries the dates of the stays named in the problems, so a screen can say which stay without another call. */
  async validation(user: AuthUser, propertyId: string, month: string): Promise<{ month: string; summary: Summary; problems: Problem[]; stays: Record<string, { checkIn: Date; checkOut: Date }> }> {
    this.assertStarted(month);
    const { built, stays } = await this.build(user.accountId, propertyId, month);
    const named = new Set(built.problems.map((p) => p.bookingId));
    return { month, summary: built.summary, problems: built.problems, stays: Object.fromEntries(stays.filter((s) => named.has(s.id)).map((s) => [s.id, { checkIn: s.checkIn, checkOut: s.checkOut }])) };
  }

  /** Renders, encrypts and stores the register; replaces (and shreds) the previous PDF of that month. */
  async generate(user: AuthUser, propertyId: string, month: string, meta: ClientMeta) {
    this.assertStarted(month);
    const { property, built } = await this.build(user.accountId, propertyId, month);
    if (built.rows.length > MAX_ROWS) throw new UnprocessableEntityException({ code: 'REGISTER_TOO_LARGE', message: 'Too many guests in this month to generate a register.' });

    let pdf: Buffer;
    try {
      pdf = await this.renderer.render(renderRegisterHtml({ property, month, rows: built.rows, summary: built.summary, generatedAt: new Date() }));
    } catch (e) {
      if (e instanceof PdfUnavailableError) throw new ServiceUnavailableException({ code: 'PDF_UNAVAILABLE', message: 'The PDF could not be generated. Try again later.' });
      throw e;
    }
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    // Provisional until the row points at it: a crash or a lost race leaves nothing the retention job cannot reach.
    const stored = await this.storage.put(user.accountId, 'POLICE_REGISTER_PDF', pdf, { expiresAt: provisionalUntil() });

    const db = this.prisma.forAccount(user.accountId);
    const fields = { templateVersion: REGISTER_TEMPLATE_VERSION, sha256, inputDigest: built.digest, guestCount: built.summary.guests, validation: built.summary as unknown as Prisma.InputJsonValue, generatedBy: user.id, generatedAt: new Date() };
    const shred = (objectId: string, registerId: string) =>
      this.storage.delete(user.accountId, objectId, { actorId: user.id, action: 'storage.object.deleted', resourceType: 'PoliceRegister', resourceId: registerId });

    // Compare-and-swap on the previous file, so parallel generations each release exactly the file they replaced.
    // The same transaction adopts the new file, marks the replaced one due for deletion and revokes the links to it.
    let swap: { registerId: string; previous: string | null; revoked: string[] } | null = null;
    try {
      for (let attempt = 0; !swap; attempt++) {
        if (attempt === SWAP_ATTEMPTS) throw new ServiceUnavailableException({ code: 'REGISTER_BUSY', message: 'The register is being generated. Try again.' });
        const row = await db.policeRegister.findFirst({ where: { propertyId, month }, select: { id: true, pdfObjectId: true } });
        swap = await db
          .$transaction(async (tx) => {
            if (!row) {
              const created = await tx.policeRegister.create({ data: { accountId: user.accountId, propertyId, month, pdfObjectId: stored.id, ...fields } });
              await handOver(tx, stored.id, null);
              return { registerId: created.id, previous: null, revoked: [] };
            }
            const swapped = await tx.policeRegister.updateMany({ where: { id: row.id, pdfObjectId: row.pdfObjectId }, data: { pdfObjectId: stored.id, ...fields } });
            if (swapped.count === 0) return null;
            await handOver(tx, stored.id, row.pdfObjectId);
            return { registerId: row.id, previous: row.pdfObjectId, revoked: await revokeLinksTo(tx, 'POLICE_REGISTER', row.id) };
          })
          .catch((e: unknown) => {
            // A parallel generation created the row first: go round again and replace that one.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
            throw e;
          });
      }
    } catch (e) {
      await shred(stored.id, `${propertyId}:${month}`).catch(() => undefined); // if this fails too, the file is provisional
      throw e;
    }
    const { registerId, previous, revoked } = swap;
    // Already due: if this delete fails, the retention job finishes it.
    if (previous) await shred(previous, registerId).catch(() => this.logger.warn(`could not remove the previous register of ${registerId}`));
    for (const id of revoked) await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'share.revoked', resourceType: 'ShareLink', resourceId: id, ip: meta.ip });

    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'register.generated', resourceType: 'PoliceRegister', resourceId: registerId, ip: meta.ip });
    return { month, templateVersion: REGISTER_TEMPLATE_VERSION, generatedAt: fields.generatedAt, summary: built.summary, problems: built.problems, revokedShares: revoked.length };
  }

  /** The PDF, decrypted in memory. The read is on the audit trail before any byte is returned. */
  async pdf(user: AuthUser, propertyId: string, month: string, meta: ClientMeta): Promise<Buffer> {
    const reg = await this.prisma.forAccount(user.accountId).policeRegister.findFirst({ where: { propertyId, month }, select: { id: true, pdfObjectId: true } });
    if (!reg) throw notFound();
    const { bytes } = await this.storage.read(user.accountId, reg.pdfObjectId, { actorId: user.id, action: 'register.read', resourceType: 'PoliceRegister', resourceId: reg.id, ip: meta.ip });
    return bytes;
  }
}
