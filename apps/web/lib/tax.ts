import type { TaxTotals } from './types';

/**
 * Display helpers for the tax estimate. Money is integer centimes and is only ever shown, never computed with
 * fractions: the text is built from the digits (string operations), so no float is involved. The API and the
 * PDF use the same convention (apps/api/src/tax/format.ts).
 */
const SEPARATORS = {
  fr: { group: ' ', decimal: ',' },
  en: { group: ',', decimal: '.' },
} as const;

const separators = (locale: string) => SEPARATORS[locale === 'en' ? 'en' : 'fr'];

/** 123450 -> '1 234,50' (fr, non-breaking space) or '1,234.50' (en). Not a safe integer -> '—'. */
export function formatCentimes(cents: number, locale = 'fr'): string {
  if (!Number.isSafeInteger(cents)) return '—';
  const { group, decimal } = separators(locale);
  const digits = String(Math.abs(cents)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${cents < 0 ? '-' : ''}${whole}${decimal}${digits.slice(-2)}`;
}

/** 1500 -> '15', 1250 -> '12,5' (fr) or '12.5' (en). Anything that is not a whole number of basis points -> null. */
export function formatBps(bps: number | string, locale = 'fr'): string | null {
  const text = String(bps);
  if (!/^\d{1,6}$/.test(text)) return null;
  const digits = text.padStart(3, '0');
  const fraction = digits.slice(-2).replace(/0+$/, '');
  return `${digits.slice(0, -2)}${fraction ? `${separators(locale).decimal}${fraction}` : ''}`;
}

/** The three taxes of a report added together. Integer centimes: the sum is exact. */
export function taxesTotal(t: Pick<TaxTotals, 'vatTotal' | 'incomeTaxTotal' | 'localTaxTotal'>): number {
  return t.vatTotal + t.incomeTaxTotal + t.localTaxTotal;
}

/** File name for an export, from the property name and the month only: ASCII, no guest or owner data. */
export function exportFilename(propertyName: string, month: string, extension: 'pdf' | 'xlsx'): string {
  const slug = propertyName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : 'mois';
  return `estimation-fiscale-${slug || 'bien'}-${safeMonth}.${extension}`;
}

/** Whether the rule statuses call for the beta wording: any rule missing or unvalidated, or no local tax rule at all. */
export function rulesAreBeta(status: { rules: { present: boolean; validated: boolean }[]; localTaxRules: number }): boolean {
  return status.localTaxRules === 0 || status.rules.length === 0 || status.rules.some((r) => !r.present || !r.validated);
}
