import { Figures, figuresOf, periodMonths, PortfolioMonth, PortfolioProperty, portfolioTotals, summarise } from './portfolio';

const figures = (over: Partial<Figures> = {}): Figures => ({ nights_revenue: 0, addon_revenue: 0, taxe_sejour_deducted: 0, gross_base: 0, income_tax: 0, vat: 0, local_tax: 0, ...over });
const month = (m: string, over: Partial<PortfolioMonth> = {}): PortfolioMonth => ({ month: m, computed: true, stays: 1, nights: 3, figures: figures(), problems: 0, beta: false, report: 'generated', ...over });
const property = (id: string, months: PortfolioMonth[]): PortfolioProperty => ({ propertyId: id, propertyName: id, ownerName: 'Owner', commune: 'Marrakech', regime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED', months });

describe('portfolio', () => {
  it('reads the figures from the lines; a line not computed or absent is null', () => {
    expect(figuresOf([{ key: 'gross_base', amount: 123_456 }, { key: 'income_tax', amount: null, note: 'rule_missing' }, { key: 'platform_commission', amount: 999, info: true }])).toEqual({
      nights_revenue: null, addon_revenue: null, taxe_sejour_deducted: null, gross_base: 123_456, income_tax: null, vat: null, local_tax: null,
    });
  });

  it('adds months in centimes, and a figure not computed in one month is not computed in the total', () => {
    const s = summarise([
      month('2026-01', { figures: figures({ gross_base: 100_001, income_tax: 10_000, local_tax: null }), nights: 4, stays: 2 }),
      month('2026-02', { figures: figures({ gross_base: 200_002, income_tax: 20_000, local_tax: 500 }), problems: 2, beta: true, report: 'outdated' }),
      month('2026-03', { figures: figures(), stays: 0, nights: 0, report: 'none' }),
    ]);
    expect(s.figures.gross_base).toBe(300_003);
    expect(s.figures.income_tax).toBe(30_000);
    expect(s.figures.local_tax).toBeNull();
    expect(s).toMatchObject({ stays: 3, nights: 7, problems: 2, beta: true, reportsCurrent: 1, months: 3 });
  });

  it('gives zeros, not "not computed", when there is nothing to add', () => {
    expect(summarise([])).toMatchObject({ figures: figures(), stays: 0, beta: false, months: 0 });
  });

  it('never returns an unsafe integer: an overflow is "not computed"', () => {
    const s = summarise([month('2026-01', { figures: figures({ gross_base: Number.MAX_SAFE_INTEGER }) }), month('2026-02', { figures: figures({ gross_base: 1 }) })]);
    expect(s.figures.gross_base).toBeNull();
  });

  it('totals the portfolio from the properties', () => {
    const { byProperty, total } = portfolioTotals([
      property('a', [month('2026-01', { figures: figures({ gross_base: 1_000, vat: 90 }) })]),
      property('b', [month('2026-01', { figures: figures({ gross_base: 2_000, vat: null }), beta: true, report: 'none' })]),
    ]);
    expect(byProperty.get('a')!.figures.vat).toBe(90);
    expect(total.figures.gross_base).toBe(3_000);
    expect(total.figures.vat).toBeNull();
    expect(total).toMatchObject({ beta: true, reportsCurrent: 1, months: 2, stays: 2, nights: 6 });
  });

  it('lists the started months of a year, or one month', () => {
    const now = new Date('2026-03-15T10:00:00Z');
    expect(periodMonths(2026, undefined, now)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(periodMonths(2025, undefined, now)).toHaveLength(12);
    expect(periodMonths(2026, 3, now)).toEqual(['2026-03']);
    expect(periodMonths(2026, 4, now)).toEqual([]);
    expect(periodMonths(2027, undefined, now)).toEqual([]);
  });
});
