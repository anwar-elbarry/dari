import { esc } from '../checkin/fiche-template';
import { formatCentimes, LINE_LABELS, noteText, PROBLEM_LABELS, REGIME_LABELS } from './format';
import { ProblemCode, ReportLine } from './pipeline';

/**
 * Monthly tax estimate: the HTML that becomes the PDF. Pure and versioned, like the Fiche and the register.
 * Every value is escaped; no scripts, no external resources. While `beta` is true (a rule used is unvalidated or
 * missing) every page carries a huge diagonal watermark and the full disclaimer text, both from RuleConfig.
 * The wording never says the figures are correct, certified or fit for filing (rule 2 in CLAUDE.md).
 */
export const TAX_TEMPLATE_VERSION = 'draft-1';

export interface DisclaimerText {
  version: string;
  banner: string;
  text: string;
}
export interface TaxTemplateData {
  property: { name: string; commune: string };
  month: string;
  regime: keyof typeof REGIME_LABELS;
  lines: ReportLine[];
  problemCounts: Partial<Record<ProblemCode, number>>;
  rules: { key: string; validated: boolean; present: boolean; validatedAt: string | null }[];
  beta: boolean;
  disclaimer: { fr: DisclaimerText; en: DisclaimerText };
  generatedAt: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;

export function renderTaxHtml(d: TaxTemplateData): string {
  const [year, month] = d.month.split('-');
  const rows = d.lines
    .map((l) => {
      const note = [noteText(l, 'fr'), noteText(l, 'en')].filter(Boolean);
      return `<tr class="${l.info ? 'info' : ''}${l.key === 'gross_base' ? ' total' : ''}">
<td>${esc(LINE_LABELS[l.key].fr)}<span>${esc(LINE_LABELS[l.key].en)}</span></td>
<td class="amt">${l.amount === null ? '<i>non calculé / not computed</i>' : esc(formatCentimes(l.amount))}</td>
<td class="note">${note.map((n) => `<bdi dir="auto">${esc(n)}</bdi>`).join('<br>')}</td>
</tr>`;
    })
    .join('\n');
  const problems = (Object.entries(d.problemCounts) as [ProblemCode, number][])
    .filter(([, n]) => n > 0)
    .map(([code, n]) => `<li>${esc(PROBLEM_LABELS[code].fr)} / ${esc(PROBLEM_LABELS[code].en)} : ${n}</li>`)
    .join('');
  const rules = d.rules
    .map((r) => `<tr><td><bdi dir="ltr">${esc(r.key)}</bdi></td><td>${r.present ? (r.validated ? `validée / validated ${esc(r.validatedAt ?? '')}` : '<b>NON VALIDÉE / UNVALIDATED</b>') : '<b>ABSENTE / MISSING</b>'}</td></tr>`)
    .join('');
  const fr = d.disclaimer.fr;
  const en = d.disclaimer.en;
  const banner = d.beta
    ? `<div class="wm" aria-hidden="true">${esc(en.banner)}<br>${esc(fr.banner)}</div>
<div class="alert"><b>${esc(en.text)}</b><br><b>${esc(fr.text)}</b></div>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Estimation fiscale</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  @page { size: A4; margin: 12mm 12mm 28mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Naskh Arabic', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; font-size: 9.5pt; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 1mm; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; }
  .sub { font-size: 8.5pt; color: #444; margin-bottom: 3mm; }
  .wm { position: fixed; top: 32%; left: -10%; width: 120%; text-align: center; transform: rotate(-32deg); font-size: 62pt; font-weight: 900; line-height: 1.05; color: rgba(190, 0, 0, 0.16); z-index: 0; }
  .alert { position: relative; z-index: 1; border: 3px solid #b00000; background: #fff0f0; color: #b00000; padding: 3mm; font-size: 11pt; text-align: center; margin: 0 0 4mm; }
  .foot { position: fixed; bottom: -22mm; left: 0; right: 0; border-top: 2px solid #b00000; padding-top: 1.5mm; font-size: 7.5pt; color: #b00000; line-height: 1.3; }
  table { position: relative; z-index: 1; width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 1.6mm 2mm; border: 1px solid #999; }
  th { background: #f3f3f3; font-size: 8.5pt; }
  th span { display: block; font-weight: 400; color: #555; }
  td span { display: block; color: #555; font-size: 8pt; }
  .amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  .note { font-size: 8pt; color: #333; }
  tr.info td { color: #555; }
  tr.total td { background: #f3f3f3; font-weight: 700; }
  tr { break-inside: avoid; }
  ul { margin: 0; padding-left: 5mm; }
</style>
</head>
<body>
${banner}
<h1>Estimation fiscale mensuelle <span style="font-weight:400;font-size:11pt">/ Monthly tax estimate</span></h1>
<div class="sub"><b>Établissement / Property:</b> <bdi dir="auto">${esc(d.property.name)}</bdi>, <bdi dir="auto">${esc(d.property.commune)}</bdi> &nbsp;·&nbsp; <b>Mois / Month:</b> ${esc(month)}/${esc(year)} &nbsp;·&nbsp; <b>Régime / Regime:</b> ${esc(REGIME_LABELS[d.regime].fr)} / ${esc(REGIME_LABELS[d.regime].en)}</div>
<table>
<thead><tr><th style="width:46%">Ligne / Line</th><th style="width:18%">Montant (MAD)<span>Amount (MAD)</span></th><th>Remarque / Note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${problems ? `<h2>Points à compléter / To complete</h2><ul>${problems}</ul>` : ''}
<h2>Règles utilisées / Rules used</h2>
<table><tbody>${rules}</tbody></table>
<p class="sub">Généré le ${esc(stamp(d.generatedAt))} · modèle ${esc(TAX_TEMPLATE_VERSION)} · ${esc(en.version)}</p>
<div class="foot">${esc(en.text)}<br>${esc(fr.text)}</div>
</body>
</html>`;
}
