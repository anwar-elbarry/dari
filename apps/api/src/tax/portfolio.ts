import { LineKey, ReportLine } from './pipeline';

/**
 * The portfolio export for the accountant: every property of the account, month by month, with the same figures as the
 * monthly estimate. Pure: integer centimes in, integer centimes out. A figure that is not computed in any month makes
 * every total it enters "not computed" (null): a missing number is better than a wrong one.
 */
export const FIGURE_KEYS = ['nights_revenue', 'addon_revenue', 'taxe_sejour_deducted', 'gross_base', 'income_tax', 'vat', 'local_tax'] as const satisfies readonly LineKey[];
export type FigureKey = (typeof FIGURE_KEYS)[number];
export type Figures = Record<FigureKey, number | null>;

/** Whether a stored monthly report matches the figures shown: `none` when it was never generated. */
export type StoredReportStatus = 'generated' | 'outdated' | 'none';

export interface PortfolioMonth {
  month: string;
  /** False when the month could not be computed (too many stays); every figure is then null. */
  computed: boolean;
  stays: number;
  nights: number;
  figures: Figures;
  /** Missing data and missing rules, counted. */
  problems: number;
  beta: boolean;
  report: StoredReportStatus;
}

export interface PortfolioProperty {
  propertyId: string;
  propertyName: string;
  commune: string;
  /** Given to the Accountant too: the income-tax rate depends on the owner (founder, 2026-10-08). */
  ownerName: string;
  regime: 'PROPERTY_INCOME' | 'PROFESSIONAL' | 'COMPANY';
  taxeSejourMode: 'INCLUDED' | 'COLLECTED';
  months: PortfolioMonth[];
}

export interface PortfolioSummary {
  stays: number;
  nights: number;
  figures: Figures;
  problems: number;
  beta: boolean;
  /** Months whose stored report matches the figures, out of the months listed. */
  reportsCurrent: number;
  months: number;
}

/** The lines of a monthly result as figures: a line that is absent or not computed is null. */
export function figuresOf(lines: ReportLine[]): Figures {
  const out = {} as Figures;
  for (const key of FIGURE_KEYS) out[key] = lines.find((l) => l.key === key)?.amount ?? null;
  return out;
}

const add = (a: number | null, b: number | null): number | null => {
  if (a === null || b === null) return null;
  const s = a + b;
  return Number.isSafeInteger(s) ? s : null;
};

const EMPTY = (): Figures => Object.fromEntries(FIGURE_KEYS.map((k) => [k, 0])) as Figures;

/** Adds monthly (or property) summaries; nothing to add gives zeros, not "not computed". */
export function summarise(items: Pick<PortfolioMonth, 'stays' | 'nights' | 'figures' | 'problems' | 'beta' | 'report'>[]): PortfolioSummary {
  const figures = EMPTY();
  let stays = 0;
  let nights = 0;
  let problems = 0;
  let beta = false;
  let current = 0;
  for (const m of items) {
    for (const k of FIGURE_KEYS) figures[k] = add(figures[k], m.figures[k]);
    stays += m.stays;
    nights += m.nights;
    problems += m.problems;
    beta ||= m.beta;
    if (m.report === 'generated') current++;
  }
  return { stays, nights, figures, problems, beta, reportsCurrent: current, months: items.length };
}

/** The summary of every property, and the total of the portfolio. */
export function portfolioTotals(properties: PortfolioProperty[]): { byProperty: Map<string, PortfolioSummary>; total: PortfolioSummary } {
  const byProperty = new Map(properties.map((p) => [p.propertyId, summarise(p.months)]));
  const all = [...byProperty.values()];
  const figures = EMPTY();
  for (const s of all) for (const k of FIGURE_KEYS) figures[k] = add(figures[k], s.figures[k]);
  const total: PortfolioSummary = {
    stays: all.reduce((a, s) => a + s.stays, 0),
    nights: all.reduce((a, s) => a + s.nights, 0),
    figures,
    problems: all.reduce((a, s) => a + s.problems, 0),
    beta: all.some((s) => s.beta),
    reportsCurrent: all.reduce((a, s) => a + s.reportsCurrent, 0),
    months: all.reduce((a, s) => a + s.months, 0),
  };
  return { byProperty, total };
}

/** The months of a period: one month, or every month of the year that has started by `now`. */
export function periodMonths(year: number, month: number | undefined, now: Date): string[] {
  const pad = (m: number) => String(m).padStart(2, '0');
  const started = (m: number) => Date.UTC(year, m - 1, 1) <= now.getTime();
  if (month !== undefined) return started(month) ? [`${year}-${pad(month)}`] : [];
  return Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(started)
    .map((m) => `${year}-${pad(m)}`);
}
