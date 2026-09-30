import { LineKey, ProblemCode, ReportLine } from './pipeline';

/** Display helpers: string operations only, never arithmetic, so a figure is shown exactly as it was computed. */

/** 123450 -> '1 234,50' (non-breaking spaces, comma decimals: the French convention the customers read). */
export function formatCentimes(cents: number | null, notComputed = '—'): string {
  if (cents === null) return notComputed;
  const s = String(Math.abs(cents)).padStart(3, '0');
  const int = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${cents < 0 ? '-' : ''}${int},${s.slice(-2)}`;
}

/** 1500 -> '15', 1250 -> '12,5'. */
export function formatBps(bps: number): string {
  const s = String(bps).padStart(3, '0');
  const frac = s.slice(-2).replace(/0+$/, '');
  return `${s.slice(0, -2)}${frac ? `,${frac}` : ''}`;
}

export const LINE_LABELS: Record<LineKey, { fr: string; en: string }> = {
  nights_revenue: { fr: 'Revenus des nuitées (nuitées + ménage - remises - remboursements)', en: 'Nights revenue (nights + cleaning - discounts - refunds)' },
  addon_revenue: { fr: 'Services additionnels', en: 'Additional services' },
  taxe_sejour_deducted: { fr: 'Taxe de séjour déduite', en: 'Taxe de séjour deducted' },
  gross_base: { fr: 'Base brute', en: 'Gross base' },
  platform_commission: { fr: 'Commission de plateforme (information)', en: 'Platform commission (information)' },
  income_tax: { fr: "Impôt sur le revenu (estimation)", en: 'Income tax (estimate)' },
  vat: { fr: 'TVA (estimation)', en: 'VAT (estimate)' },
  local_tax: { fr: 'Taxes locales (estimation)', en: 'Local taxes (estimate)' },
  nonresident_statement: { fr: 'Non-résident / MRE', en: 'Non-resident / MRE' },
};

export const PROBLEM_LABELS: Record<ProblemCode, { fr: string; en: string }> = {
  NO_AMOUNTS: { fr: 'Séjours sans montants', en: 'Stays without amounts' },
  TAXE_SEJOUR_MISSING: { fr: 'Séjours sans taxe de séjour (mode inclus)', en: 'Stays without Taxe de séjour (included mode)' },
  PARTY_SIZE_MISSING: { fr: 'Séjours sans nombre de voyageurs', en: 'Stays without a party size' },
  RULE_MISSING: { fr: 'Règles manquantes', en: 'Missing rules' },
};

export const REGIME_LABELS = {
  PROPERTY_INCOME: { fr: 'Revenus fonciers', en: 'Property income' },
  PROFESSIONAL: { fr: 'Régime professionnel', en: 'Professional' },
  COMPANY: { fr: 'Société', en: 'Company' },
} as const;

/** The note of a line in words, in one language. */
export function noteText(l: ReportLine, lang: 'fr' | 'en'): string {
  const t = (fr: string, en: string) => (lang === 'fr' ? fr : en);
  switch (l.note) {
    case 'not_applicable':
      return t('Sans objet', 'Not applicable');
    case 'not_deducted':
      return t('Non déduite de la base', 'Not deducted from the base');
    case 'rule_missing':
      return t(`Non calculé : règle manquante (${l.detail ?? ''})`, `Not computed: rule missing (${l.detail ?? ''})`);
    case 'rate_bps':
      return t(`Taux ${formatBps(Number(l.detail))} %`, `Rate ${formatBps(Number(l.detail))}%`);
    case 'catch_up':
      return t(`Taux ${formatBps(Number(l.detail))} % appliqué au cumul annuel (régularisation)`, `Rate ${formatBps(Number(l.detail))}% applied to the year to date (catch-up)`);
    case 'residency':
      return t(`Propriétaire non résident (${l.detail ?? ''}) : relevé à établir avec votre comptable`, `Non-resident owner (${l.detail ?? ''}): statement to prepare with your accountant`);
    default:
      return '';
  }
}
