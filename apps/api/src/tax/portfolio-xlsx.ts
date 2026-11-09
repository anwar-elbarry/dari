import ExcelJS from 'exceljs';
import { REGIME_LABELS, REPORT_STATUS_LABELS, TAXE_SEJOUR_MODE_LABELS } from './format';
import { centimesToDecimal } from './money';
import { FIGURE_KEYS, FigureKey, PortfolioProperty, PortfolioSummary, portfolioTotals } from './portfolio';
import { disclaimedWorkbook, safeText } from './tax-xlsx';
import { TaxTemplateData } from './tax-template';

/**
 * The portfolio export: every property of the account over a month or a year, for the accountant. Same rules as the
 * monthly export (`tax-xlsx.ts`): values only, no formulas, every text neutralised, the disclaimer on every sheet and
 * the beta banner and watermark while any figure is a beta. Totals are computed in centimes (`portfolio.ts`), never by
 * the spreadsheet. Built on request and never stored.
 */
export const PORTFOLIO_XLSX_VERSION = 'portfolio-1';

export interface PortfolioExportData extends Pick<TaxTemplateData, 'beta' | 'disclaimer' | 'generatedAt' | 'rules'> {
  year: number;
  month?: number;
  properties: PortfolioProperty[];
}

const FIGURE_HEADERS: Record<FigureKey, string> = {
  nights_revenue: 'Revenus des nuitées / Nights revenue',
  addon_revenue: 'Services / Add-ons',
  taxe_sejour_deducted: 'Taxe de séjour déduite / deducted',
  gross_base: 'Base brute / Gross base',
  income_tax: 'IR (estimation) / Income tax (estimate)',
  vat: 'TVA (estimation) / VAT (estimate)',
  local_tax: 'Taxes locales (estimation) / Local taxes (estimate)',
};
const NOT_COMPUTED = 'non calculé / not computed';
const both = (l: { fr: string; en: string }) => `${l.fr} / ${l.en}`;

function header(ws: ExcelJS.Worksheet, r: number, titles: string[]) {
  const row = ws.getRow(r);
  titles.forEach((t, i) => {
    const c = row.getCell(i + 1);
    c.value = t;
    c.font = { bold: true };
    c.alignment = { wrapText: true, vertical: 'top' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };
  });
}

/** Amounts as numbers from their exact two-decimal text; nothing is calculated here. */
function money(cell: ExcelJS.Cell, cents: number | null) {
  if (cents === null) cell.value = NOT_COMPUTED;
  else {
    cell.value = Number(centimesToDecimal(cents));
    cell.numFmt = '#,##0.00';
  }
  cell.alignment = { horizontal: 'right' };
}

export async function buildPortfolioWorkbook(d: PortfolioExportData): Promise<Buffer> {
  const { wb, frame } = await disclaimedWorkbook(d);
  const { byProperty, total } = portfolioTotals(d.properties);
  const period = d.month ? `${String(d.month).padStart(2, '0')}/${d.year}` : String(d.year);

  // Sheet 1: one line per property over the period, and the total.
  const ws = wb.addWorksheet('Summary');
  const summaryTitles = ['Propriétaire / Owner', 'Bien / Property', 'Commune', 'Régime / Regime', 'Taxe de séjour', 'Séjours / Stays', 'Nuitées / Nights', ...FIGURE_KEYS.map((k) => FIGURE_HEADERS[k]), 'Points à compléter / To complete', 'Rapports mensuels à jour / Monthly reports up to date'];
  ws.columns = summaryTitles.map((_, i) => ({ width: i < 2 ? 30 : 18 }));
  let r = frame(ws, summaryTitles.length);
  for (const [k, v] of [
    ['Période / Period', period],
    ['Biens / Properties', String(d.properties.length)],
  ]) {
    ws.getRow(r).getCell(1).value = k;
    ws.getRow(r).getCell(1).font = { bold: true };
    ws.getRow(r++).getCell(2).value = v;
  }
  r++;
  header(ws, r++, summaryTitles);
  const summaryRow = (cells: (string | number)[], s: PortfolioSummary, bold = false) => {
    const row = ws.getRow(r++);
    let c = 1;
    for (const v of cells) row.getCell(c++).value = typeof v === 'string' ? safeText(v) : v;
    row.getCell(c++).value = s.stays;
    row.getCell(c++).value = s.nights;
    for (const k of FIGURE_KEYS) money(row.getCell(c++), s.figures[k]);
    row.getCell(c++).value = s.problems;
    row.getCell(c++).value = `${s.reportsCurrent}/${s.months}`;
    if (bold) row.font = { bold: true };
  };
  for (const p of d.properties) {
    summaryRow([p.ownerName, p.propertyName, p.commune, both(REGIME_LABELS[p.regime]), both(TAXE_SEJOUR_MODE_LABELS[p.taxeSejourMode])], byProperty.get(p.propertyId)!);
  }
  summaryRow(['', 'Total', '', '', ''], total, true);

  // Sheet 2: one line per property and month, with the status of its stored monthly report.
  const ms = wb.addWorksheet('Months');
  const monthTitles = ['Propriétaire / Owner', 'Bien / Property', 'Mois / Month', 'Séjours / Stays', 'Nuitées / Nights', ...FIGURE_KEYS.map((k) => FIGURE_HEADERS[k]), 'Points à compléter / To complete', 'Rapport mensuel / Monthly report'];
  ms.columns = monthTitles.map((_, i) => ({ width: i < 2 ? 30 : 18 }));
  let q = frame(ms, monthTitles.length);
  header(ms, q++, monthTitles);
  for (const p of d.properties) {
    for (const m of p.months) {
      const row = ms.getRow(q++);
      let c = 1;
      row.getCell(c++).value = safeText(p.ownerName);
      row.getCell(c++).value = safeText(p.propertyName);
      const [y, mo] = m.month.split('-');
      row.getCell(c++).value = `${mo}/${y}`;
      row.getCell(c++).value = m.stays;
      row.getCell(c++).value = m.nights;
      for (const k of FIGURE_KEYS) money(row.getCell(c++), m.figures[k]);
      row.getCell(c++).value = m.computed ? m.problems : 'trop de séjours / too many stays';
      row.getCell(c++).value = both(REPORT_STATUS_LABELS[m.report]);
    }
  }

  // Sheet 3: the rules behind the figures.
  const rs = wb.addWorksheet('Rules');
  rs.columns = [{ width: 40 }, { width: 40 }];
  let n = frame(rs, 2);
  header(rs, n++, ['Règle / Rule', 'Statut / Status']);
  for (const x of d.rules) {
    rs.getRow(n).getCell(1).value = safeText(x.key);
    rs.getRow(n++).getCell(2).value = x.present ? (x.validated ? `validée / validated ${x.validatedAt ?? ''}`.trim() : 'NON VALIDÉE / UNVALIDATED') : 'ABSENTE / MISSING';
  }
  n++;
  rs.getRow(n).getCell(1).value = safeText(`Généré / Generated: ${d.generatedAt.toISOString()} | ${PORTFOLIO_XLSX_VERSION} | ${d.disclaimer.en.version}`);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
