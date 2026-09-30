/**
 * The parameters the tax pipeline reads. Every value comes from RuleConfig / TaxRule rows (rule 1 in CLAUDE.md):
 * nothing here is a rate or a threshold. A parser returns `null` for a row that is missing or malformed, so the
 * pipeline says "not computed" instead of guessing. `validated` is true only when a fiduciaire filled `validatedBy`.
 */
export interface RuleValue<T> {
  key: string;
  value: T | null;
  validated: boolean;
  validatedAt: string | null;
}

export interface PropertyIncomeRule {
  /** Annual gross base, in centimes, up to and including which the lower rate applies. */
  thresholdCentimes: number;
  belowBps: number;
  aboveBps: number;
}
export interface VatRule {
  rateBps: number;
  /** INCLUSIVE: the gross base already contains the VAT; EXCLUSIVE: the VAT comes on top. */
  basis: 'INCLUSIVE' | 'EXCLUSIVE';
}
export interface RoundingRule {
  mode: 'HALF_UP';
  scope: 'LINE';
}
export interface StayMonthRule {
  rule: 'CHECKOUT_MONTH' | 'CHECKIN_MONTH';
}
export interface LocalTaxRule {
  /** MAD per person per night, in centimes. */
  perPersonNightCentimes: number;
}

export interface TaxRules {
  propertyIncome: RuleValue<PropertyIncomeRule>;
  vat: RuleValue<VatRule>;
  rounding: RuleValue<RoundingRule>;
  stayMonth: RuleValue<StayMonthRule>;
  /** From TaxRule (commune + licence type + effective date), null when no row applies. */
  localTax: RuleValue<LocalTaxRule>;
}

export const RULE_KEYS = {
  propertyIncome: 'tax.property_income',
  vat: 'tax.vat',
  rounding: 'tax.rounding',
  stayMonth: 'tax.stay_month',
  localTax: 'tax_rule.local',
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parsePropertyIncome(v: unknown): PropertyIncomeRule | null {
  if (!isObject(v) || v.mode !== 'WHOLE') return null; // only "the rate applies to the whole annual amount" is implemented
  const thresholdCentimes = int(v.thresholdCentimes, 0, 1e12);
  const belowBps = int(v.belowBps, 0, 10_000);
  const aboveBps = int(v.aboveBps, 0, 10_000);
  return thresholdCentimes === null || belowBps === null || aboveBps === null ? null : { thresholdCentimes, belowBps, aboveBps };
}
export function parseVat(v: unknown): VatRule | null {
  if (!isObject(v)) return null;
  const rateBps = int(v.rateBps, 0, 10_000);
  return rateBps === null || (v.basis !== 'INCLUSIVE' && v.basis !== 'EXCLUSIVE') ? null : { rateBps, basis: v.basis };
}
export function parseRounding(v: unknown): RoundingRule | null {
  return isObject(v) && v.mode === 'HALF_UP' && v.scope === 'LINE' ? { mode: 'HALF_UP', scope: 'LINE' } : null;
}
export function parseStayMonth(v: unknown): StayMonthRule | null {
  return isObject(v) && (v.rule === 'CHECKOUT_MONTH' || v.rule === 'CHECKIN_MONTH') ? { rule: v.rule } : null;
}

/** The rule set with nothing known: every line reports "not computed". Used in tests and as the safe fallback. */
export function emptyRules(): TaxRules {
  const none = <T>(key: string): RuleValue<T> => ({ key, value: null, validated: false, validatedAt: null });
  return {
    propertyIncome: none(RULE_KEYS.propertyIncome),
    vat: none(RULE_KEYS.vat),
    rounding: none(RULE_KEYS.rounding),
    stayMonth: none(RULE_KEYS.stayMonth),
    localTax: none(RULE_KEYS.localTax),
  };
}
