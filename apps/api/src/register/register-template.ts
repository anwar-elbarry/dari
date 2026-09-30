import { esc, fmtDate } from '../checkin/fiche-template';
import { RegisterProperty, RegisterRow, Summary } from './register-build';

/**
 * Monthly police register: the HTML that becomes the PDF. Pure and versioned, like the Fiche.
 *
 * REGISTER_TEMPLATE_VERSION is stored with every generated register. The layout is a working draft: it has to be
 * compared with the official register once the prefecture provides it (open decision 1 in docs/phase-4.md), and
 * the version bumped. The wording never says "compliant", "certified" or "approved" (rule 2 in CLAUDE.md), only
 * that the layout is indicative and the content comes from the travellers' declarations.
 * Every value is escaped and rendered with `dir="auto"`; no scripts, no external resources, no images.
 */
export const REGISTER_TEMPLATE_VERSION = 'draft-1';

export interface RegisterData {
  property: RegisterProperty;
  /** YYYY-MM */
  month: string;
  rows: RegisterRow[];
  summary: Summary;
  generatedAt: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDateTime = (d: Date) => `${fmtDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
const DOC = { PASSPORT: 'Passeport / Passport', CIN: 'CIN / ID card' } as const;
const cell = (v: string | null, nowrap = false) => `<td${nowrap ? ' class="nw"' : ''}><bdi dir="auto">${v ? esc(v) : '&nbsp;'}</bdi></td>`;

export function renderRegisterHtml(d: RegisterData): string {
  const [year, month] = d.month.split('-');
  const body = d.rows
    .map((r) => {
      const g = r.guest;
      return `<tr>
<td>${r.n}</td>
<td class="nw">${esc(fmtDate(r.checkIn))}</td>
<td class="nw">${esc(fmtDate(r.checkOut))}${r.continuesNextMonth ? ' †' : ''}</td>
${cell(g.fullName)}${cell(fmtDate(g.dob), true)}${cell(g.nationality)}${cell(g.docType ? DOC[g.docType] : null)}${cell(g.docNumber)}${cell(g.entryStampNumber)}${cell(g.cityOfOrigin)}${cell(g.nextDestination)}${cell(g.profession)}
</tr>`;
    })
    .join('\n');
  const incomplete =
    d.summary.problems > 0
      ? `<div class="warn">${d.summary.problems} point(s) incomplet(s) lors de la génération; le registre est à compléter avant tout usage. / ${d.summary.problems} incomplete point(s) at generation; complete the register before use.</div>`
      : '';
  const continues = d.rows.some((r) => r.continuesNextMonth) ? '<br>† Séjour se poursuivant le mois suivant, listé au mois d\'arrivée. / † Stay continues into the following month, listed under the month of arrival.' : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Registre de police</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Naskh Arabic', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; font-size: 8.5pt; color: #111; }
  h1 { font-size: 15pt; margin: 0 0 1mm; }
  .sub { font-size: 8pt; color: #444; margin-bottom: 3mm; }
  .meta { font-size: 9pt; margin-bottom: 3mm; }
  .warn { border: 1px solid #111; padding: 1.5mm 2mm; margin-bottom: 3mm; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { text-align: left; vertical-align: top; padding: 1.2mm 1.5mm; border: 1px solid #999; overflow-wrap: anywhere; }
  th { background: #f3f3f3; font-weight: 600; font-size: 7pt; overflow-wrap: normal; }
  .nw { white-space: nowrap; }
  th span { display: block; font-weight: 400; color: #555; }
  .foot { margin-top: 4mm; font-size: 7.5pt; color: #444; line-height: 1.4; }
</style>
</head>
<body>
<h1>Registre de police <span style="font-weight:400;font-size:11pt">/ Police register</span></h1>
<div class="sub">Mise en forme indicative, à comparer au modèle officiel de la préfecture. / Indicative layout: compare with the official prefecture form.</div>
<div class="meta"><b>Établissement / Establishment:</b> <bdi dir="auto">${esc(d.property.name)}</bdi>, <bdi dir="auto">${esc(d.property.address)}</bdi>, <bdi dir="auto">${esc(d.property.commune)}</bdi> &nbsp;·&nbsp; <b>Mois / Month:</b> ${esc(month)}/${esc(year)} &nbsp;·&nbsp; <b>Voyageurs / Guests:</b> ${d.summary.guests}</div>
${incomplete}
<table>
<colgroup><col style="width:3.5%"><col style="width:8%"><col style="width:8.5%"><col style="width:12.5%"><col style="width:8%"><col style="width:7.5%"><col style="width:8%"><col style="width:10%"><col style="width:7.5%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:8%"></colgroup>
<thead><tr>
<th>N°</th><th>Arrivée<span>Arrival</span></th><th>Départ<span>Departure</span></th><th>Nom et prénoms<span>Full name</span></th><th>Naissance<span>Birth</span></th><th>Nationalité<span>Nationality</span></th><th>Pièce<span>Document</span></th><th>N° de la pièce<span>Document no.</span></th><th>Cachet d'entrée<span>Entry stamp</span></th><th>Provenance<span>From</span></th><th>Destination<span>Next</span></th><th>Profession<span>Profession</span></th>
</tr></thead>
<tbody>
${body || '<tr><td colspan="12">Aucun voyageur enregistré pour ce mois. / No guest recorded for this month.</td></tr>'}
</tbody>
</table>
<div class="foot">
  Établi à partir des déclarations des voyageurs; à vérifier par l'établissement. / Prepared from the travellers' declarations; to be checked by the establishment.${continues}<br>
  Généré le ${esc(fmtDateTime(d.generatedAt))} · modèle ${esc(REGISTER_TEMPLATE_VERSION)}
</div>
</body>
</html>`;
}
