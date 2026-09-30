import { computeMonth, PipelineInput, stayBase, StayInput } from './pipeline';
import { emptyRules, RULE_KEYS, TaxRules } from './rules';

/** Hand-checked examples. The rates below are TEST FIXTURES, not the product's: the product reads RuleConfig. */
const ok = <T>(key: string, value: T, validated = false) => ({ key, value, validated, validatedAt: validated ? '2026-10-01' : null });

function rules(over: Partial<TaxRules> = {}, validated = false): TaxRules {
  return {
    propertyIncome: ok(RULE_KEYS.propertyIncome, { thresholdCentimes: 12_000_000, belowBps: 1000, aboveBps: 1500 }, validated),
    vat: ok(RULE_KEYS.vat, { rateBps: 1000, basis: 'INCLUSIVE' as const }, validated),
    rounding: ok(RULE_KEYS.rounding, { mode: 'HALF_UP' as const, scope: 'LINE' as const }, validated),
    stayMonth: ok(RULE_KEYS.stayMonth, { rule: 'CHECKOUT_MONTH' as const }, validated),
    localTax: { key: RULE_KEYS.localTax, value: null, validated: false, validatedAt: null },
    ...over,
  };
}
const stay = (over: Partial<StayInput> = {}): StayInput => ({
  bookingId: 'b1', nights: 2, partySize: 2, hasAmounts: true, nightly: 0, cleaning: 0, addons: 0, discounts: 0, refunds: 0, commission: 0, taxeSejour: null, ...over,
});
const base = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  regime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED', residency: 'RESIDENT', bankAccountType: 'STANDARD',
  stays: [stay({ nightly: 2_000_000 })], cumulative: { ownerGross: 10_000_000, ownerGrossPrev: 8_000_000, propertyGross: 10_000_000, propertyGrossPrev: 8_000_000 },
  rules: rules(), ...over,
});
const line = (r: ReturnType<typeof computeMonth>, key: string) => r.lines.find((l) => l.key === key)!;

describe('gross base and Taxe de Séjour', () => {
  it('nights revenue = nightly + cleaning - discounts - refunds; add-ons apart; commission is information only', () => {
    const r = computeMonth(base({ stays: [stay({ nightly: 100_000, cleaning: 10_000, discounts: 5_000, refunds: 2_000, addons: 30_000, commission: 15_000 })] }));
    expect(line(r, 'nights_revenue').amount).toBe(103_000);
    expect(line(r, 'addon_revenue').amount).toBe(30_000);
    expect(line(r, 'gross_base').amount).toBe(133_000);
    expect(line(r, 'platform_commission')).toMatchObject({ amount: 15_000, info: true, note: 'not_deducted' });
    expect(r.totals.grossBase).toBe(133_000);
  });

  it('deducts an included Taxe de Séjour from the base, and leaves a collected one alone', () => {
    const stays = [stay({ nightly: 100_000, taxeSejour: 4_000 })];
    expect(computeMonth(base({ stays, taxeSejourMode: 'INCLUDED' })).totals).toMatchObject({ grossBase: 96_000, taxeSejourDeducted: 4_000 });
    const collected = computeMonth(base({ stays, taxeSejourMode: 'COLLECTED' }));
    expect(collected.totals).toMatchObject({ grossBase: 100_000, taxeSejourDeducted: 0 });
    expect(line(collected, 'taxe_sejour_deducted').note).toBe('not_applicable');
  });

  it('reports a stay without amounts and an included Taxe de Séjour that is unknown, by booking id', () => {
    const r = computeMonth(base({ taxeSejourMode: 'INCLUDED', stays: [stay({ bookingId: 'x1', hasAmounts: false }), stay({ bookingId: 'x2', nightly: 1, taxeSejour: null })] }));
    expect(r.problems).toEqual(expect.arrayContaining([{ code: 'NO_AMOUNTS', bookingId: 'x1' }, { code: 'TAXE_SEJOUR_MISSING', bookingId: 'x1' }, { code: 'TAXE_SEJOUR_MISSING', bookingId: 'x2' }]));
  });

  it('stayBase is the definition the annual sums use', () => {
    expect(stayBase(stay({ nightly: 100, cleaning: 20, addons: 5, discounts: 10, refunds: 3, taxeSejour: 7 }), 'INCLUDED')).toBe(105);
    expect(stayBase(stay({ nightly: 100, cleaning: 20, addons: 5, discounts: 10, refunds: 3, taxeSejour: 7 }), 'COLLECTED')).toBe(112);
  });
});

describe('property income tax (annual rate on the owner, catch-up per property)', () => {
  it('applies the lower rate to the year to date, less what earlier months gave', () => {
    // 100 000 MAD year to date at 10 % = 10 000; 80 000 before at 10 % = 8 000; this month owes 2 000.
    const r = computeMonth(base());
    expect(line(r, 'income_tax')).toMatchObject({ amount: 200_000, note: 'rate_bps', detail: '1000' });
    expect(r.totals.incomeTaxTotal).toBe(200_000);
    expect(line(r, 'vat')).toMatchObject({ amount: 0, note: 'not_applicable' });
  });

  it('exactly at the threshold is still the lower rate', () => {
    const r = computeMonth(base({ cumulative: { ownerGross: 12_000_000, ownerGrossPrev: 10_000_000, propertyGross: 12_000_000, propertyGrossPrev: 10_000_000 } }));
    expect(line(r, 'income_tax')).toMatchObject({ amount: 200_000, detail: '1000' });
  });

  it('crossing the threshold moves the whole year to date to the higher rate (catch-up)', () => {
    // 130 000 at 15 % = 19 500; 110 000 already taxed at 10 % = 11 000; this month owes 8 500.
    const r = computeMonth(base({ cumulative: { ownerGross: 13_000_000, ownerGrossPrev: 11_000_000, propertyGross: 13_000_000, propertyGrossPrev: 11_000_000 } }));
    expect(line(r, 'income_tax')).toMatchObject({ amount: 850_000, note: 'catch_up', detail: '1500' });
  });

  it('uses the owner total for the rate and the property total for the amount', () => {
    // The owner has another property: 130 000 in all, this property 50 000 (40 000 before).
    const r = computeMonth(base({ cumulative: { ownerGross: 13_000_000, ownerGrossPrev: 11_000_000, propertyGross: 5_000_000, propertyGrossPrev: 4_000_000 } }));
    expect(line(r, 'income_tax').amount).toBe(750_000 - 400_000); // 15 % of 50 000 less 10 % of 40 000
  });

  it('is never negative, and rounds half-up per line', () => {
    expect(computeMonth(base({ cumulative: { ownerGross: 1_000, ownerGrossPrev: 1_000, propertyGross: -5_000, propertyGrossPrev: 0 } })).totals.incomeTaxTotal).toBe(0);
    expect(computeMonth(base({ cumulative: { ownerGross: 1_005, ownerGrossPrev: 0, propertyGross: 1_005, propertyGrossPrev: 0 } })).totals.incomeTaxTotal).toBe(101);
  });

  it('is not computed, and says so, when the rule is missing', () => {
    const r = computeMonth(base({ rules: rules({ propertyIncome: { key: RULE_KEYS.propertyIncome, value: null, validated: false, validatedAt: null } }) }));
    expect(line(r, 'income_tax')).toMatchObject({ amount: null, note: 'rule_missing' });
    expect(r.problems).toContainEqual({ code: 'RULE_MISSING', rule: RULE_KEYS.propertyIncome });
    expect(r.totals.incomeTaxTotal).toBe(0);
  });
});

describe('VAT for professional and company regimes', () => {
  it('extracts a tax-inclusive VAT and rounds half-up', () => {
    const r = computeMonth(base({ regime: 'PROFESSIONAL', stays: [stay({ nightly: 110_000 })] }));
    expect(line(r, 'vat')).toMatchObject({ amount: 10_000, note: 'rate_bps', detail: '1000' });
    expect(computeMonth(base({ regime: 'COMPANY', stays: [stay({ nightly: 1_000 })] })).totals.vatTotal).toBe(91);
  });

  it('adds an exclusive VAT on top of the base', () => {
    const exclusive = rules({ vat: ok(RULE_KEYS.vat, { rateBps: 1000, basis: 'EXCLUSIVE' as const }) });
    expect(computeMonth(base({ regime: 'PROFESSIONAL', rules: exclusive, stays: [stay({ nightly: 110_000 })] })).totals.vatTotal).toBe(11_000);
  });

  it('has no income-tax rule for these regimes: the line is not computed and listed', () => {
    const r = computeMonth(base({ regime: 'PROFESSIONAL' }));
    expect(line(r, 'income_tax')).toMatchObject({ amount: null, note: 'rule_missing' });
    expect(r.problems).toContainEqual({ code: 'RULE_MISSING', rule: 'tax.income_tax.professional' });
    expect(r.totals.incomeTaxTotal).toBe(0);
  });

  it('is not computed when the VAT rule is missing', () => {
    const r = computeMonth(base({ regime: 'COMPANY', rules: rules({ vat: { key: RULE_KEYS.vat, value: null, validated: false, validatedAt: null } }) }));
    expect(line(r, 'vat')).toMatchObject({ amount: null, note: 'rule_missing' });
  });
});

describe('local taxes and statements', () => {
  const withLocal = (validated = false) => rules({ localTax: ok(RULE_KEYS.localTax, { perPersonNightCentimes: 250 }, validated) });

  it('multiplies the per person night amount by guests and nights, and names stays without a party size', () => {
    const r = computeMonth(base({ rules: withLocal(), stays: [stay({ nights: 3, partySize: 2 }), stay({ bookingId: 'b2', nights: 1, partySize: 4 }), stay({ bookingId: 'b3', partySize: null })] }));
    expect(line(r, 'local_tax').amount).toBe((3 * 2 + 1 * 4) * 250);
    expect(r.problems).toContainEqual({ code: 'PARTY_SIZE_MISSING', bookingId: 'b3' });
  });

  it('is not computed without a TaxRule', () => {
    const r = computeMonth(base());
    expect(line(r, 'local_tax')).toMatchObject({ amount: null, note: 'rule_missing' });
    expect(r.totals.localTaxTotal).toBe(0);
  });

  it('adds a statement line for a non-resident or MRE owner and none for a resident', () => {
    expect(computeMonth(base()).lines.some((l) => l.key === 'nonresident_statement')).toBe(false);
    const r = computeMonth(base({ residency: 'MRE', bankAccountType: 'CONVERTIBLE_DIRHAM' }));
    expect(line(r, 'nonresident_statement')).toMatchObject({ amount: null, info: true, detail: 'MRE/CONVERTIBLE_DIRHAM' });
  });
});

describe('beta status', () => {
  const complete = () => base({ rules: rules({ localTax: ok(RULE_KEYS.localTax, { perPersonNightCentimes: 250 }, true) }, true) });

  it('is beta as soon as one rule used is unvalidated', () => {
    expect(computeMonth(base()).beta).toBe(true);
  });

  it('is beta when a rule is missing, even if every rule that exists is validated', () => {
    const r = computeMonth(base({ rules: { ...complete().rules, propertyIncome: { key: RULE_KEYS.propertyIncome, value: null, validated: true, validatedAt: '2026-10-01' } } }));
    expect(r.beta).toBe(true);
    expect(r.rulesUsed.find((x) => x.key === RULE_KEYS.propertyIncome)).toMatchObject({ present: false, validated: false });
  });

  it('is not beta when every rule used is present and validated', () => {
    const r = computeMonth(complete());
    expect(r.beta).toBe(false);
    expect(r.problems.filter((p) => p.code === 'RULE_MISSING')).toEqual([]);
  });

  it('is beta when a stay is incomplete, even if every rule is validated', () => {
    const c = complete();
    expect(computeMonth({ ...c, stays: [stay({ nightly: 1_000 }), stay({ bookingId: 'x', hasAmounts: false })] }).beta).toBe(true);
    expect(computeMonth({ ...c, stays: [stay({ nightly: 1_000, partySize: null })] }).beta).toBe(true);
  });

  it('with no rule at all, every figure that needs one is not computed and nothing throws', () => {
    const r = computeMonth(base({ rules: emptyRules() }));
    expect(r.beta).toBe(true);
    expect(line(r, 'income_tax').amount).toBeNull();
    expect(line(r, 'local_tax').amount).toBeNull();
    expect(line(r, 'gross_base').amount).toBe(2_000_000); // the base needs no rule
  });
});
