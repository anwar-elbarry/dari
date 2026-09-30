import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { LINE_LABELS, noteText, PROBLEM_LABELS, REGIME_LABELS } from './format';
import { centimesToDecimal } from './money';
import { ProblemCode } from './pipeline';
import { TaxTemplateData } from './tax-template';

/**
 * The Excel export of a monthly tax estimate. Values only (no formulas: nothing to inject, nothing that recalculates
 * to a different figure), every text neutralised against formula prefixes. While `beta` is true each sheet carries a
 * huge red banner and the full disclaimer at the top, the same in the print header and footer, and a diagonal
 * watermark as the sheet background. Spreadsheets have no true watermark: the banner rows are the part that cannot be missed.
 */
export const TAX_XLSX_VERSION = 'draft-1';

/** Text cells: a value starting with = + - @ is prefixed so a spreadsheet can never read it as a formula. */
export const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
/** The print header and footer treat & as a control character, and hold 255 characters per part. */
/** Escaped first, then cut so a cut can never leave half an escape; the whole part (codes included) stays under Excel's 255. */
const hf = (s: string, max: number) => {
  let out = '';
  for (const ch of s) {
    const piece = ch === '&' ? '&&' : ch;
    if (out.length + piece.length > max) break;
    out += piece;
  }
  return out;
};

const RED = 'FFB00000';
const PALE = 'FFFFF0F0';

async function watermarkPng(lines: string[]): Promise<Buffer | null> {
  try {
    const text = lines.map((l, i) => `<text x="50%" y="${44 + i * 34}%" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="46" font-weight="bold" fill="#b00000" fill-opacity="0.16" transform="rotate(-30 300 200)">${l.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</text>`).join('');
    return await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">${text}</svg>`)).png().toBuffer();
  } catch {
    return null; // a missing font or renderer must not block the export: the banner rows remain
  }
}

export async function buildTaxWorkbook(d: TaxTemplateData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dari';
  wb.created = d.generatedAt;
  const { fr, en } = d.disclaimer;
  const watermark = d.beta ? await watermarkPng([en.banner, fr.banner]) : null;
  const bg = watermark ? wb.addImage({ buffer: watermark as unknown as ExcelJS.Buffer, extension: 'png' }) : null;

  function frame(ws: ExcelJS.Worksheet, columns: number) {
    ws.views = [{ showGridLines: false }];
    if (d.beta) {
      // Codes take about 25 characters; the two banners share the rest.
      ws.headerFooter.oddHeader = `&C&"Arial,Bold"&16&K${RED.slice(2)}${hf(en.banner, 100)} / ${hf(fr.banner, 100)}`;
      if (bg !== null) ws.addBackgroundImage(bg);
    }
    ws.headerFooter.oddFooter = `&L&8 ${hf(en.text, 240)}`; // the space keeps a text that starts with a digit from being read as part of the font size
    let r = 1;
    if (d.beta) {
      const banner = ws.getRow(r);
      ws.mergeCells(r, 1, r, columns);
      banner.getCell(1).value = `${en.banner}  /  ${fr.banner}`;
      banner.getCell(1).font = { bold: true, size: 26, color: { argb: RED } };
      banner.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      banner.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
      banner.height = 54;
      r++;
      for (const t of [en.text, fr.text]) {
        ws.mergeCells(r, 1, r, columns);
        const c = ws.getRow(r).getCell(1);
        c.value = t;
        c.font = { bold: true, size: 12, color: { argb: RED } };
        c.alignment = { wrapText: true, vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
        ws.getRow(r).height = 48;
        r++;
      }
      r++;
    } else {
      ws.mergeCells(r, 1, r, columns);
      ws.getRow(r).getCell(1).value = en.text;
      ws.getRow(r).getCell(1).font = { bold: true, size: 11 };
      r += 2;
    }
    return r;
  }

  // Sheet 1: the report.
  const ws = wb.addWorksheet('Report');
  ws.columns = [{ width: 62 }, { width: 20 }, { width: 70 }];
  let r = frame(ws, 3);
  const [year, month] = d.month.split('-');
  for (const [k, v] of [
    ['Établissement / Property', safeText(`${d.property.name}, ${d.property.commune}`)],
    ['Mois / Month', `${month}/${year}`],
    ['Régime / Regime', `${REGIME_LABELS[d.regime].fr} / ${REGIME_LABELS[d.regime].en}`],
  ] as const) {
    ws.getRow(r).getCell(1).value = k;
    ws.getRow(r).getCell(1).font = { bold: true };
    ws.getRow(r).getCell(2).value = v;
    ws.mergeCells(r, 2, r, 3);
    r++;
  }
  r++;
  const head = ws.getRow(r++);
  ['Ligne / Line', 'Montant MAD / Amount MAD', 'Remarque / Note'].forEach((t, i) => {
    head.getCell(i + 1).value = t;
    head.getCell(i + 1).font = { bold: true };
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };
  });
  for (const l of d.lines) {
    const row = ws.getRow(r++);
    row.getCell(1).value = `${LINE_LABELS[l.key].fr} / ${LINE_LABELS[l.key].en}`;
    // Amounts are written as numbers for the spreadsheet from their exact two-decimal text; nothing is calculated here.
    if (l.amount === null) row.getCell(2).value = 'non calculé / not computed';
    else {
      row.getCell(2).value = Number(centimesToDecimal(l.amount));
      row.getCell(2).numFmt = '#,##0.00';
    }
    row.getCell(2).alignment = { horizontal: 'right' };
    row.getCell(3).value = safeText([noteText(l, 'fr'), noteText(l, 'en')].filter(Boolean).join(' | '));
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    if (l.key === 'gross_base') row.font = { bold: true };
  }

  const counts = (Object.entries(d.problemCounts) as [ProblemCode, number][]).filter(([, n]) => n > 0);
  if (counts.length) {
    r++;
    ws.getRow(r).getCell(1).value = 'Points à compléter / To complete';
    ws.getRow(r++).getCell(1).font = { bold: true };
    for (const [code, n] of counts) {
      ws.getRow(r).getCell(1).value = `${PROBLEM_LABELS[code].fr} / ${PROBLEM_LABELS[code].en}`;
      ws.getRow(r++).getCell(2).value = n;
    }
  }

  // Sheet 2: the rules behind the figures.
  const rs = wb.addWorksheet('Rules');
  rs.columns = [{ width: 40 }, { width: 40 }];
  let q = frame(rs, 2);
  const rh = rs.getRow(q++);
  rh.getCell(1).value = 'Règle / Rule';
  rh.getCell(2).value = 'Statut / Status';
  rh.font = { bold: true };
  for (const x of d.rules) {
    rs.getRow(q).getCell(1).value = safeText(x.key);
    rs.getRow(q++).getCell(2).value = x.present ? (x.validated ? `validée / validated ${x.validatedAt ?? ''}`.trim() : 'NON VALIDÉE / UNVALIDATED') : 'ABSENTE / MISSING';
  }
  q++;
  rs.getRow(q).getCell(1).value = safeText(`Généré / Generated: ${d.generatedAt.toISOString()} | ${TAX_XLSX_VERSION} | ${en.version}`);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
