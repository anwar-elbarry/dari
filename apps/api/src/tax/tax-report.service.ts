import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, TaxReport } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PdfRenderer, PdfUnavailableError } from '../checkin/pdf-renderer';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { lastMonths, monthOf, parseMonth } from '../register/register-month';
import { handOver, provisionalUntil } from '../storage/hand-over';
import { StorageService } from '../storage/storage.service';
import { centimesToDecimal, toCentimes } from './money';
import { computeMonth, PipelineInput, PipelineResult, Problem, ProblemCode, stayBase, StayInput } from './pipeline';
import { TaxRulesService } from './tax-rules.service';
import { renderTaxHtml, TAX_TEMPLATE_VERSION, TaxTemplateData } from './tax-template';
import { buildTaxWorkbook } from './tax-xlsx';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

export const REPORT_MONTHS = 24;
/** Every Decimal(12,2) column holds up to 9 999 999 999.99; a total beyond this is refused rather than overflowing. */
const MAX_TOTAL_CENTIMES = 999_999_999_999;
/** A year of stays for one owner this large is refused rather than summed. */
const MAX_STAYS = 20_000;
/** The account-wide list re-checks this many reports for staleness. */
const LIST_LIMIT = 300;
/** Parallel generations of one month retry the swap this many times before giving up. */
const SWAP_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

/** Only confirmed stays that count as bookings, as for the register and the day counter. */
const COUNTED = { status: 'CONFIRMED', classification: 'BOOKING' } as const;

const AMOUNTS = { partySize: true, nightlyRevenue: true, cleaningFee: true, addonRevenue: true, discounts: true, refunds: true, platformCommission: true, taxeSejourAmount: true } as const;
const STAY_SELECT = { id: true, propertyId: true, checkIn: true, checkOut: true, ...AMOUNTS } satisfies Prisma.BookingSelect;
type StayRow = Prisma.BookingGetPayload<{ select: typeof STAY_SELECT }>;

export type ReportStatus = 'none' | 'generated' | 'outdated';

const c = (v: Prisma.Decimal | null) => toCentimes(v);

/** A per-request cache: listing many reports shares rule reads and the year's stays instead of repeating them for each one. */
type Cache = Map<string, unknown>;
async function memo<T>(cache: Cache, key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as Promise<T>;
}

function toInput(s: StayRow): StayInput {
  const nightly = c(s.nightlyRevenue);
  const cleaning = c(s.cleaningFee);
  const addons = c(s.addonRevenue);
  const discounts = c(s.discounts);
  const refunds = c(s.refunds);
  return {
    bookingId: s.id,
    nights: Math.max(0, Math.round((s.checkOut.getTime() - s.checkIn.getTime()) / DAY_MS)),
    partySize: s.partySize,
    hasAmounts: [nightly, cleaning, addons, discounts, refunds, c(s.platformCommission), c(s.taxeSejourAmount)].some((x) => x !== null),
    nightly: nightly ?? 0,
    cleaning: cleaning ?? 0,
    addons: addons ?? 0,
    discounts: discounts ?? 0,
    refunds: refunds ?? 0,
    commission: c(s.platformCommission) ?? 0,
    taxeSejour: c(s.taxeSejourAmount),
  };
}

function counts(problems: Problem[]): Partial<Record<ProblemCode, number>> {
  const out: Partial<Record<ProblemCode, number>> = {};
  for (const p of problems) out[p.code] = (out[p.code] ?? 0) + 1;
  return out;
}

/**
 * Monthly tax estimates (Phase 5): build from the month's stays and the rules, render PDF and Excel, store both as
 * encrypted files, and know when a report no longer matches the data. Every figure is an ESTIMATE; while a rule used
 * is unvalidated the report and its exports are labelled as a beta (see `tax-template.ts`).
 */
@Injectable()
export class TaxReportService {
  private readonly logger = new Logger('TaxReport');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly rules: TaxRulesService,
    private readonly renderer: PdfRenderer,
  ) {}

  private assertMonth(month: string) {
    if (!parseMonth(month)) throw new BadRequestException({ code: 'INVALID_MONTH', message: 'The month must look like 2026-10.' });
  }

  /** A month that has not started has no report to build. */
  private assertStarted(month: string, now = new Date()) {
    if (parseMonth(month)!.start.getTime() > now.getTime()) throw new UnprocessableEntityException({ code: 'MONTH_NOT_STARTED', message: 'This month has not started yet.' });
  }

  private async property(accountId: string, propertyId: string) {
    const p = await this.prisma.forAccount(accountId).property.findFirst({
      where: { id: propertyId },
      select: { id: true, name: true, commune: true, licenseType: true, taxRegime: true, taxeSejourMode: true, ownerId: true, owner: { select: { residency: true, bankAccountType: true } } },
    });
    if (!p) throw notFound();
    return p;
  }

  /** Everything a report depends on, the computation, and the digest that tells whether a stored report is still current. */
  private async build(accountId: string, propertyId: string, month: string, cache: Cache = new Map()) {
    const bounds = parseMonth(month)!;
    const property = await memo(cache, `p:${propertyId}`, () => this.property(accountId, propertyId));
    const db = this.prisma.forAccount(accountId);
    const rules = await memo(cache, `r:${property.commune}:${property.licenseType}:${month}`, () => this.rules.load(property.commune, property.licenseType, bounds.end));
    const field = rules.stayMonth.value?.rule === 'CHECKIN_MONTH' ? 'checkIn' : 'checkOut'; // no rule: check-out month, reported as a missing rule below

    // The rate depends on the owner's annual total, so all of the owner's properties are summed.
    // Only properties under the same income regime add up: a professional or company property is another taxpayer's base.
    const scope = property.taxRegime === 'PROPERTY_INCOME' ? { ownerId: property.ownerId, taxRegime: 'PROPERTY_INCOME' as const } : { id: propertyId };
    const owned = await memo(cache, `o:${property.ownerId}:${property.taxRegime === 'PROPERTY_INCOME' ? 'pi' : propertyId}`, () => db.property.findMany({ where: scope, select: { id: true, taxeSejourMode: true } }));
    const modeOf = new Map(owned.map((p) => [p.id, p.taxeSejourMode]));
    const year = Number(month.slice(0, 4));
    const end = bounds.end;
    // One query per owner and year, shared by every month of that year in this request.
    const yearRows = await memo(cache, `y:${owned.map((p) => p.id).sort().join(',')}:${year}:${field}`, () =>
      db.booking.findMany({
        where: { propertyId: { in: owned.map((p) => p.id) }, ...COUNTED, [field]: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        select: STAY_SELECT,
        orderBy: [{ [field]: 'asc' }, { id: 'asc' }],
        take: MAX_STAYS + 1,
      }),
    );
    const rows = yearRows.filter((s) => s[field].getTime() < end.getTime());
    if (yearRows.length > MAX_STAYS) throw new UnprocessableEntityException({ code: 'REPORT_TOO_LARGE', message: 'Too many stays this year to build a report.' });

    const cumulative = { ownerGross: 0, ownerGrossPrev: 0, propertyGross: 0, propertyGrossPrev: 0 };
    const monthRows: StayRow[] = [];
    for (const s of rows) {
      const base = stayBase(toInput(s), modeOf.get(s.propertyId) ?? 'COLLECTED');
      const before = s[field].getTime() < bounds.start.getTime();
      cumulative.ownerGross += base;
      if (before) cumulative.ownerGrossPrev += base;
      if (s.propertyId === propertyId) {
        cumulative.propertyGross += base;
        if (before) cumulative.propertyGrossPrev += base;
        if (monthOf(s[field]) === month) monthRows.push(s);
      }
    }
    const stays = monthRows.map(toInput);
    const input: PipelineInput = {
      regime: property.taxRegime, taxeSejourMode: property.taxeSejourMode, residency: property.owner.residency, bankAccountType: property.owner.bankAccountType,
      stays, cumulative, rules,
    };
    const result = computeMonth(input);
    // A missing stay-month rule is a gap like any other: the default is used and the report says so.
    if (rules.stayMonth.value === null) {
      result.problems.push({ code: 'RULE_MISSING', rule: rules.stayMonth.key });
      result.rulesUsed.push({ key: rules.stayMonth.key, validated: false, validatedAt: null, present: false });
      result.beta = true;
    } else {
      result.rulesUsed.push({ key: rules.stayMonth.key, validated: rules.stayMonth.validated, validatedAt: rules.stayMonth.validatedAt, present: true });
      if (!rules.stayMonth.validated) result.beta = true;
    }
    for (const total of Object.values(result.totals)) {
      if (Math.abs(total) > MAX_TOTAL_CENTIMES) throw new UnprocessableEntityException({ code: 'REPORT_TOO_LARGE', message: 'The totals of this month are too large to report.' });
    }
    // The wording is part of what a report says: a changed disclaimer makes a stored report outdated.
    const disclaimer = await memo(cache, `d:${result.beta}`, () => this.rules.disclaimer(result.beta));
    const digest = createHash('sha256')
      .update(JSON.stringify({ v: 2, month, regime: property.taxRegime, mode: property.taxeSejourMode, owner: property.owner, stays, cumulative, rules, disclaimer: [disclaimer.en.version, disclaimer.fr.version] }))
      .digest('hex');
    return { property, monthRows, input, result, digest, disclaimer };
  }

  private template(property: { name: string; commune: string }, month: string, regime: PipelineInput['regime'], result: PipelineResult, disclaimer: TaxTemplateData['disclaimer'], generatedAt: Date): TaxTemplateData {
    return { property, month, regime, lines: result.lines, problemCounts: counts(result.problems), rules: result.rulesUsed, beta: result.beta, disclaimer, generatedAt };
  }

  private view(row: TaxReport & { property: { name: string } }, status: ReportStatus, detailed: boolean, full = true) {
    const cents = (d: Prisma.Decimal) => toCentimes(d)!;
    const problems = row.problems as unknown as Problem[];
    return {
      id: row.id,
      propertyId: row.propertyId,
      propertyName: row.property.name,
      month: row.month,
      regime: row.regime,
      status,
      beta: row.unvalidated,
      totals: { nightsRevenue: cents(row.nightsRevenue), addonRevenue: cents(row.addonRevenue), grossBase: cents(row.grossBase), taxeSejourDeducted: cents(row.taxeSejourDeducted), vatTotal: cents(row.vatTotal), incomeTaxTotal: cents(row.incomeTaxTotal), localTaxTotal: cents(row.localTaxTotal) },
      lines: full ? row.lines : undefined,
      problemCounts: counts(problems),
      // Booking ids lead into stays and guests: only the people who may edit them get the list.
      problems: detailed ? problems : undefined,
      rules: full ? row.ruleVersions : undefined,
      bankAccountType: row.bankAccountType,
      templateVersion: row.templateVersion,
      disclaimerVersion: row.disclaimerVersion,
      generatedAt: row.generatedAt,
    };
  }

  private async statusOf(accountId: string, row: Pick<TaxReport, 'propertyId' | 'month' | 'inputDigest'>, cache: Cache = new Map()): Promise<ReportStatus> {
    try {
      return (await this.build(accountId, row.propertyId, row.month, cache)).digest === row.inputDigest ? 'generated' : 'outdated';
    } catch {
      return 'outdated';
    }
  }

  /** The months of one property with their status (Owner/Manager). */
  async months(user: AuthUser, propertyId: string, now = new Date()) {
    const property = await this.property(user.accountId, propertyId);
    const cache: Cache = new Map();
    const reports = await this.prisma.forAccount(user.accountId).taxReport.findMany({ where: { propertyId }, include: { property: { select: { name: true } } } });
    const byMonth = new Map(reports.map((r) => [r.month, r]));
    const months = [...new Set([...lastMonths(now, REPORT_MONTHS), ...byMonth.keys()])].sort().reverse();
    const out = [];
    for (const month of months) {
      const r = byMonth.get(month);
      out.push(r ? { month, status: await this.statusOf(user.accountId, r, cache), reportId: r.id, generatedAt: r.generatedAt, beta: r.unvalidated } : { month, status: 'none' as ReportStatus, reportId: null, generatedAt: null, beta: null });
    }
    return { property: { id: property.id, name: property.name, regime: property.taxRegime, taxeSejourMode: property.taxeSejourMode }, months: out };
  }

  /** Every report of the account, newest month first (Owner/Manager and Accountant). Accountants get counts, not booking ids. */
  async list(user: AuthUser, filter: { year?: number; propertyId?: string } = {}): Promise<{ reports: ReturnType<TaxReportService['view']>[]; truncated: boolean }> {
    const db = this.prisma.forAccount(user.accountId);
    const detailed = can(user.role, 'report:generate');
    const cache: Cache = new Map();
    const rows = await db.taxReport.findMany({
      where: { ...(filter.propertyId ? { propertyId: filter.propertyId } : {}), ...(filter.year ? { month: { startsWith: `${filter.year}-` } } : {}) },
      orderBy: [{ month: 'desc' }, { generatedAt: 'desc' }],
      take: LIST_LIMIT + 1,
      include: { property: { select: { name: true } } },
    });
    const out = [];
    for (const r of rows.slice(0, LIST_LIMIT)) out.push(this.view(r, await this.statusOf(user.accountId, r, cache), detailed, false));
    return { reports: out, truncated: rows.length > LIST_LIMIT };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.forAccount(user.accountId).taxReport.findFirst({ where: { id }, include: { property: { select: { name: true } } } });
    if (!row) throw notFound();
    return this.view(row, await this.statusOf(user.accountId, row), can(user.role, 'report:generate'));
  }

  /** What is missing for a month, before generating: problems by stay id and rule key, and the dates of the stays named. */
  async missing(user: AuthUser, propertyId: string, month: string) {
    this.assertMonth(month);
    this.assertStarted(month);
    const { result, monthRows } = await this.build(user.accountId, propertyId, month);
    const named = new Set(result.problems.map((p) => p.bookingId).filter((x): x is string => !!x));
    return {
      month,
      beta: result.beta,
      problems: result.problems,
      problemCounts: counts(result.problems),
      stays: Object.fromEntries(monthRows.filter((s) => named.has(s.id)).map((s) => [s.id, { checkIn: s.checkIn, checkOut: s.checkOut }])),
    };
  }

  /** Renders and stores the PDF and the Excel export; replaces (and shreds) the previous pair of that month. */
  async generate(user: AuthUser, propertyId: string, month: string, meta: ClientMeta) {
    this.assertMonth(month);
    this.assertStarted(month);
    const { property, input, result, digest, disclaimer } = await this.build(user.accountId, propertyId, month);
    const generatedAt = new Date();
    const tpl = this.template(property, month, input.regime, result, disclaimer, generatedAt);

    let pdf: Buffer;
    try {
      pdf = await this.renderer.render(renderTaxHtml(tpl));
    } catch (e) {
      if (e instanceof PdfUnavailableError) throw new ServiceUnavailableException({ code: 'PDF_UNAVAILABLE', message: 'The PDF could not be generated. Try again later.' });
      throw e;
    }
    const xlsx = await buildTaxWorkbook(tpl);

    // Provisional until the row points at them: a crash or a lost race leaves nothing the retention job cannot reach.
    const pdfObj = await this.storage.put(user.accountId, 'TAX_REPORT_PDF', pdf, { expiresAt: provisionalUntil() });
    const shred = (objectId: string, resourceId: string) => this.storage.delete(user.accountId, objectId, { actorId: user.id, action: 'storage.object.deleted', resourceType: 'TaxReport', resourceId });
    let xlsxObj: Awaited<ReturnType<StorageService['put']>>;
    try {
      xlsxObj = await this.storage.put(user.accountId, 'TAX_REPORT_XLSX', xlsx, { expiresAt: provisionalUntil() });
    } catch (e) {
      await shred(pdfObj.id, `${propertyId}:${month}`).catch(() => undefined);
      throw e;
    }

    const t = result.totals;
    const fields = {
      regime: input.regime,
      nightsRevenue: centimesToDecimal(t.nightsRevenue), addonRevenue: centimesToDecimal(t.addonRevenue), grossBase: centimesToDecimal(t.grossBase),
      taxeSejourDeducted: centimesToDecimal(t.taxeSejourDeducted), vatTotal: centimesToDecimal(t.vatTotal), incomeTaxTotal: centimesToDecimal(t.incomeTaxTotal), localTaxTotal: centimesToDecimal(t.localTaxTotal),
      bankAccountType: input.residency === 'RESIDENT' ? null : input.bankAccountType,
      lines: result.lines as unknown as Prisma.InputJsonValue,
      problems: result.problems as unknown as Prisma.InputJsonValue,
      ruleVersions: result.rulesUsed as unknown as Prisma.InputJsonValue,
      unvalidated: result.beta,
      inputDigest: digest,
      pdfObjectId: pdfObj.id,
      xlsxObjectId: xlsxObj.id,
      templateVersion: TAX_TEMPLATE_VERSION,
      disclaimerVersion: `${disclaimer.en.version}/${disclaimer.fr.version}`,
      generatedBy: user.id,
      generatedAt,
    };

    // Compare-and-swap on the previous PDF, so parallel generations each release exactly the files they replaced.
    const db = this.prisma.forAccount(user.accountId);
    let swap: { id: string; previous: { pdf: string; xlsx: string } | null } | null = null;
    try {
      for (let attempt = 0; !swap; attempt++) {
        if (attempt === SWAP_ATTEMPTS) throw new ServiceUnavailableException({ code: 'REPORT_BUSY', message: 'The report is being generated. Try again.' });
        const row = await db.taxReport.findFirst({ where: { propertyId, month }, select: { id: true, pdfObjectId: true, xlsxObjectId: true } });
        swap = await db
          .$transaction(async (tx) => {
            if (!row) {
              const created = await tx.taxReport.create({ data: { accountId: user.accountId, propertyId, month, ...fields } });
              await handOver(tx, pdfObj.id, null);
              await handOver(tx, xlsxObj.id, null);
              return { id: created.id, previous: null };
            }
            const swapped = await tx.taxReport.updateMany({ where: { id: row.id, pdfObjectId: row.pdfObjectId }, data: fields });
            if (swapped.count === 0) return null;
            await handOver(tx, pdfObj.id, row.pdfObjectId);
            await handOver(tx, xlsxObj.id, row.xlsxObjectId);
            return { id: row.id, previous: { pdf: row.pdfObjectId, xlsx: row.xlsxObjectId } };
          })
          .catch((e: unknown) => {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // a parallel generation created the row first
            throw e;
          });
      }
    } catch (e) {
      await shred(pdfObj.id, `${propertyId}:${month}`).catch(() => undefined); // if this fails too, the file is provisional
      await shred(xlsxObj.id, `${propertyId}:${month}`).catch(() => undefined);
      throw e;
    }
    // Already due: if a delete fails, the retention job finishes it.
    if (swap.previous) for (const old of [swap.previous.pdf, swap.previous.xlsx]) await shred(old, swap.id).catch(() => this.logger.warn(`could not remove a previous file of report ${swap!.id}`));
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'tax.report.generated', resourceType: 'TaxReport', resourceId: swap.id, ip: meta.ip });
    return this.detail(user, swap.id);
  }

  /** One export, decrypted in memory. The read is on the audit trail before any byte is returned. */
  async file(user: AuthUser, id: string, kind: 'pdf' | 'xlsx', meta: ClientMeta): Promise<Buffer> {
    const row = await this.prisma.forAccount(user.accountId).taxReport.findFirst({ where: { id }, select: { id: true, propertyId: true, month: true, inputDigest: true, pdfObjectId: true, xlsxObjectId: true } });
    if (!row) throw notFound();
    // An export that no longer matches the data or the rules (or a rule turned unvalidated since) is not handed out: regenerate first.
    if ((await this.statusOf(user.accountId, row)) !== 'generated') throw new ConflictException({ code: 'REPORT_OUTDATED', message: 'This report is out of date. Generate it again before opening it.' });
    const { bytes } = await this.storage.read(user.accountId, kind === 'pdf' ? row.pdfObjectId : row.xlsxObjectId, { actorId: user.id, action: 'tax.export.read', resourceType: 'TaxReport', resourceId: row.id, ip: meta.ip });
    return bytes;
  }
}

