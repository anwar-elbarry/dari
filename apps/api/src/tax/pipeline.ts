import { grossBase } from './gross-base';
import { mulBps, mulRatio, nonNegative } from './money';
import { RuleValue, TaxRules } from './rules';

/**
 * Monthly tax ESTIMATE for one property (Business Spec 3.B / Tech Spec 6.3). Pure: integer centimes in, integer
 * centimes out, no clock, no database, no rate or threshold of its own. Steps, each a line of the report:
 *   gross base -> Taxe de Séjour treatment -> regime (income tax or VAT) -> local taxes -> statements.
 * A step whose rule is missing or malformed is "not computed" (amount null) and is listed as a problem: a missing
 * number is better than a wrong one. Nothing here claims the result is correct or filed anywhere.
 */
export type Regime = 'PROPERTY_INCOME' | 'PROFESSIONAL' | 'COMPANY';
export type TaxeSejourMode = 'INCLUDED' | 'COLLECTED';

export interface StayInput {
  bookingId: string;
  nights: number;
  partySize: number | null;
  /** False when the stay has no revenue figure at all (an iCal stay whose amounts were never entered). */
  hasAmounts: boolean;
  nightly: number;
  cleaning: number;
  addons: number;
  discounts: number;
  refunds: number;
  commission: number;
  /** Taxe de Séjour recorded on the stay, null when unknown. */
  taxeSejour: number | null;
}

/** Annual (calendar-year) gross bases in centimes, through the month and through the month before. */
export interface Cumulative {
  ownerGross: number;
  ownerGrossPrev: number;
  propertyGross: number;
  propertyGrossPrev: number;
}

export interface PipelineInput {
  regime: Regime;
  taxeSejourMode: TaxeSejourMode;
  residency: 'RESIDENT' | 'NON_RESIDENT' | 'MRE';
  bankAccountType: 'STANDARD' | 'CONVERTIBLE_DIRHAM' | 'FOREIGN_CURRENCY';
  stays: StayInput[];
  cumulative: Cumulative;
  rules: TaxRules;
}

export type LineKey =
  | 'nights_revenue'
  | 'addon_revenue'
  | 'taxe_sejour_deducted'
  | 'gross_base'
  | 'platform_commission'
  | 'income_tax'
  | 'vat'
  | 'local_tax'
  | 'nonresident_statement';

export interface ReportLine {
  key: LineKey;
  /** Integer centimes; null = not computed. */
  amount: number | null;
  /** True for lines that do not add up into a total (commission, statements). */
  info?: boolean;
  /** Machine-readable reason or detail, translated by the screens and templates. */
  note?: 'not_applicable' | 'rule_missing' | 'rate_bps' | 'catch_up' | 'residency' | 'not_deducted';
  /** Extra detail for the note: the rate in basis points, or the residency and account type. */
  detail?: string;
}

export type ProblemCode = 'NO_AMOUNTS' | 'TAXE_SEJOUR_MISSING' | 'PARTY_SIZE_MISSING' | 'RULE_MISSING';
export interface Problem {
  code: ProblemCode;
  /** Stay-level problems name the booking (an id, never a guest); rule-level ones name the rule key. */
  bookingId?: string;
  rule?: string;
}

export interface Totals {
  nightsRevenue: number;
  addonRevenue: number;
  taxeSejourDeducted: number;
  grossBase: number;
  vatTotal: number;
  incomeTaxTotal: number;
  localTaxTotal: number;
}

export interface PipelineResult {
  lines: ReportLine[];
  totals: Totals;
  problems: Problem[];
  /** Every rule consulted for this property, with its validation status. */
  rulesUsed: { key: string; validated: boolean; validatedAt: string | null; present: boolean }[];
  /** True when any rule used is unvalidated or missing, or when a stay's figures are incomplete: the report is a beta estimate and its exports carry the watermark. */
  beta: boolean;
}

/** A stay's contribution to the annual gross base: the spec's gross base, minus an included Taxe de Séjour. Shared with the service so the annual sums use the same definition. */
export function stayBase(s: Pick<StayInput, 'nightly' | 'cleaning' | 'addons' | 'discounts' | 'refunds' | 'taxeSejour'>, mode: TaxeSejourMode): number {
  return grossBase({ nightly: s.nightly, cleaning: s.cleaning, addons: s.addons, discounts: s.discounts, refunds: s.refunds }) - (mode === 'INCLUDED' ? (s.taxeSejour ?? 0) : 0);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The rate the annual base falls under: the lower one up to and including the threshold, the higher one above it. */
function rateBps(annualGross: number, r: { thresholdCentimes: number; belowBps: number; aboveBps: number }): number {
  return annualGross <= r.thresholdCentimes ? r.belowBps : r.aboveBps;
}

export function computeMonth(input: PipelineInput): PipelineResult {
  const { regime, taxeSejourMode: mode, rules, stays } = input;
  const problems: Problem[] = [];
  const consulted: RuleValue<unknown>[] = [rules.rounding];
  const gap = (r: RuleValue<unknown>) => problems.push({ code: 'RULE_MISSING', rule: r.key });
  if (rules.rounding.value === null) gap(rules.rounding); // half-up per line is the only mode implemented, so figures are still produced

  for (const s of stays) {
    if (!s.hasAmounts) problems.push({ code: 'NO_AMOUNTS', bookingId: s.bookingId });
    if (mode === 'INCLUDED' && s.taxeSejour === null) problems.push({ code: 'TAXE_SEJOUR_MISSING', bookingId: s.bookingId });
  }

  const nightsRevenue = sum(stays.map((s) => s.nightly + s.cleaning - s.discounts - s.refunds));
  const addonRevenue = sum(stays.map((s) => s.addons));
  const taxeSejourDeducted = mode === 'INCLUDED' ? sum(stays.map((s) => s.taxeSejour ?? 0)) : 0;
  const gross = sum(stays.map((s) => stayBase(s, mode)));
  const commission = sum(stays.map((s) => s.commission));

  const lines: ReportLine[] = [
    { key: 'nights_revenue', amount: nightsRevenue },
    { key: 'addon_revenue', amount: addonRevenue },
    { key: 'taxe_sejour_deducted', amount: taxeSejourDeducted, note: mode === 'INCLUDED' ? undefined : 'not_applicable' },
    { key: 'gross_base', amount: gross },
    { key: 'platform_commission', amount: commission, info: true, note: 'not_deducted' },
  ];

  // Income tax (property income only): the rate depends on the OWNER's annual gross base, across all of their properties.
  let incomeTax = 0;
  if (regime === 'PROPERTY_INCOME') {
    consulted.push(rules.propertyIncome);
    const r = rules.propertyIncome.value;
    if (!r) {
      gap(rules.propertyIncome);
      lines.push({ key: 'income_tax', amount: null, note: 'rule_missing', detail: rules.propertyIncome.key });
    } else {
      const c = input.cumulative;
      const now = rateBps(c.ownerGross, r);
      const before = rateBps(c.ownerGrossPrev, r);
      // Tax on the property's year to date at this month's rate, less what the previous month's rate already gave.
      // When the owner crosses the threshold, the whole year to date moves to the higher rate: a catch-up.
      // Never negative: a refund that lowers the year to date is not a tax credit in this estimate.
      incomeTax = nonNegative(mulBps(nonNegative(c.propertyGross), now) - mulBps(nonNegative(c.propertyGrossPrev), before));
      lines.push({ key: 'income_tax', amount: incomeTax, note: now !== before && c.propertyGrossPrev > 0 ? 'catch_up' : 'rate_bps', detail: String(now) });
    }
    lines.push({ key: 'vat', amount: 0, note: 'not_applicable' });
  } else {
    // Professional and company regimes: VAT is computed when its rule exists; no income-tax rule is implemented for them.
    const incomeTaxKey = `tax.income_tax.${regime.toLowerCase()}`;
    problems.push({ code: 'RULE_MISSING', rule: incomeTaxKey });
    lines.push({ key: 'income_tax', amount: null, note: 'rule_missing', detail: incomeTaxKey });
    consulted.push(rules.vat);
    const v = rules.vat.value;
    let vat = 0;
    if (!v) {
      gap(rules.vat);
      lines.push({ key: 'vat', amount: null, note: 'rule_missing', detail: rules.vat.key });
    } else {
      vat = v.basis === 'INCLUSIVE' ? mulRatio(nonNegative(gross), v.rateBps, 10_000 + v.rateBps) : mulBps(nonNegative(gross), v.rateBps);
      lines.push({ key: 'vat', amount: vat, note: 'rate_bps', detail: String(v.rateBps) });
    }
    return finish(lines, { nightsRevenue, addonRevenue, taxeSejourDeducted, gross, incomeTax: 0, vat, localTax: 0 }, problems, consulted, input);
  }
  return finish(lines, { nightsRevenue, addonRevenue, taxeSejourDeducted, gross, incomeTax, vat: 0, localTax: 0 }, problems, consulted, input);
}

/** Local taxes and statements are common to every regime; this closes the report. */
function finish(
  lines: ReportLine[],
  t: { nightsRevenue: number; addonRevenue: number; taxeSejourDeducted: number; gross: number; incomeTax: number; vat: number; localTax: number },
  problems: Problem[],
  consulted: RuleValue<unknown>[],
  input: PipelineInput,
): PipelineResult {
  const { rules, stays } = input;
  consulted.push(rules.localTax);
  const lt = rules.localTax.value;
  let localTax = 0;
  if (!lt) {
    problems.push({ code: 'RULE_MISSING', rule: rules.localTax.key });
    lines.push({ key: 'local_tax', amount: null, note: 'rule_missing', detail: rules.localTax.key });
  } else {
    let personNights = 0;
    for (const s of stays) {
      if (s.partySize === null) problems.push({ code: 'PARTY_SIZE_MISSING', bookingId: s.bookingId });
      else personNights += s.partySize * s.nights;
    }
    localTax = mulRatio(personNights, lt.perPersonNightCentimes, 1);
    lines.push({ key: 'local_tax', amount: localTax });
  }

  if (input.residency !== 'RESIDENT') {
    lines.push({ key: 'nonresident_statement', amount: null, info: true, note: 'residency', detail: `${input.residency}/${input.bankAccountType}` });
  }

  const seen = new Set<string>();
  const rulesUsed = consulted
    .filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)))
    .map((r) => ({ key: r.key, validated: r.value !== null && r.validated, validatedAt: r.validatedAt, present: r.value !== null }));
  // An incomplete month (a stay without amounts, a party size or an included Taxe de séjour) is never presented as a finished figure.
  const gap = problems.length > 0;
  return {
    lines,
    totals: { nightsRevenue: t.nightsRevenue, addonRevenue: t.addonRevenue, taxeSejourDeducted: t.taxeSejourDeducted, grossBase: t.gross, vatTotal: t.vat, incomeTaxTotal: t.incomeTax, localTaxTotal: localTax },
    problems,
    rulesUsed,
    beta: gap || rulesUsed.some((r) => !r.validated),
  };
}


