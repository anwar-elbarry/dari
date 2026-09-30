import { exportFilename, formatBps, formatCentimes, rulesAreBeta, taxesTotal } from './tax';

describe('formatCentimes', () => {
  it('pads, groups thousands and uses the locale decimal mark', () => {
    expect(formatCentimes(0, 'fr')).toBe('0,00');
    expect(formatCentimes(5, 'fr')).toBe('0,05');
    expect(formatCentimes(50, 'en')).toBe('0.50');
    expect(formatCentimes(123450, 'fr')).toBe('1 234,50');
    expect(formatCentimes(123450, 'en')).toBe('1,234.50');
    expect(formatCentimes(100000000, 'en')).toBe('1,000,000.00');
    expect(formatCentimes(99900, 'fr')).toBe('999,00');
  });

  it('keeps the sign', () => {
    expect(formatCentimes(-123450, 'en')).toBe('-1,234.50');
    expect(formatCentimes(-1, 'fr')).toBe('-0,01');
  });

  it('is exact for large integers, where a division by 100 would round', () => {
    expect(formatCentimes(9007199254740991, 'en')).toBe('90,071,992,547,409.91');
  });

  it('refuses a value that is not a safe integer instead of guessing', () => {
    expect(formatCentimes(12.5, 'fr')).toBe('—');
    expect(formatCentimes(Number.NaN, 'fr')).toBe('—');
    expect(formatCentimes(1e21, 'fr')).toBe('—');
  });

  it('defaults to French', () => {
    expect(formatCentimes(123, undefined)).toBe('1,23');
  });
});

describe('formatBps', () => {
  it('shows basis points as a percentage without arithmetic', () => {
    expect(formatBps(1500, 'fr')).toBe('15');
    expect(formatBps('1250', 'fr')).toBe('12,5');
    expect(formatBps('1250', 'en')).toBe('12.5');
    expect(formatBps('2000', 'en')).toBe('20');
    expect(formatBps('5', 'fr')).toBe('0,05');
    expect(formatBps('0', 'fr')).toBe('0');
    expect(formatBps('1234', 'fr')).toBe('12,34');
  });

  it('returns null when the detail is not basis points', () => {
    expect(formatBps('', 'fr')).toBeNull();
    expect(formatBps('12.5', 'fr')).toBeNull();
    expect(formatBps('-3', 'fr')).toBeNull();
    expect(formatBps('tax.vat', 'fr')).toBeNull();
    expect(formatBps('1'.repeat(7), 'fr')).toBeNull();
  });
});

describe('taxesTotal', () => {
  it('adds the three taxes', () => {
    expect(taxesTotal({ vatTotal: 100, incomeTaxTotal: 250, localTaxTotal: 5 })).toBe(355);
  });
});

describe('exportFilename', () => {
  it('builds an ASCII name from the property and the month', () => {
    expect(exportFilename('Riad Démo & Spa', '2026-09', 'xlsx')).toBe('estimation-fiscale-riad-demo-spa-2026-09.xlsx');
  });

  it('has a fallback and never lets an odd month through', () => {
    expect(exportFilename('***', '2026-09', 'pdf')).toBe('estimation-fiscale-bien-2026-09.pdf');
    expect(exportFilename('Riad', '../etc', 'pdf')).toBe('estimation-fiscale-riad-mois.pdf');
  });

  it('caps the length', () => {
    expect(exportFilename('a'.repeat(200), '2026-01', 'pdf').length).toBeLessThan(80);
  });
});

describe('rulesAreBeta', () => {
  const ok = { present: true, validated: true };
  it('is false only when every rule is present and validated and local rules exist', () => {
    expect(rulesAreBeta({ rules: [ok, ok], localTaxRules: 2 })).toBe(false);
  });
  it('is true when a rule is unvalidated, absent, or there is no local tax rule', () => {
    expect(rulesAreBeta({ rules: [ok, { present: true, validated: false }], localTaxRules: 2 })).toBe(true);
    expect(rulesAreBeta({ rules: [ok, { present: false, validated: false }], localTaxRules: 2 })).toBe(true);
    expect(rulesAreBeta({ rules: [ok], localTaxRules: 0 })).toBe(true);
    expect(rulesAreBeta({ rules: [], localTaxRules: 3 })).toBe(true);
  });
});
