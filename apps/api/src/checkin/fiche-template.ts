/**
 * Fiche de Police: the HTML that becomes the PDF. Pure and versioned.
 *
 * TEMPLATE_VERSION is stored with every generated Fiche. The layout is a working draft: it has to be matched to
 * the official form once the prefecture / DGSN provides it (hard gate 4 in docs/phase-3.md), and the version
 * bumped. The wording only ever says the sheet is laid out like the form and built from the traveller's
 * declaration: never "compliant", "certified" or "approved" (rule 2 in CLAUDE.md).
 *
 * Every value is HTML-escaped and rendered with `dir="auto"` so Arabic and Latin names both display correctly.
 * The document has no scripts, no external resources and no images.
 */
export const TEMPLATE_VERSION = 'draft-1';

export interface FicheData {
  property: { name: string; address: string; commune: string };
  stay: { checkIn: Date; checkOut: Date };
  guest: {
    id: string;
    guestIndex: number | null;
    docType: 'PASSPORT' | 'CIN' | null;
    fullName: string | null;
    nationality: string | null;
    docNumber: string | null;
    dob: Date | null;
    docExpiryDate: Date | null;
    declaredMoroccanNationality: boolean;
    entryStampNumber: string | null;
    cityOfOrigin: string | null;
    nextDestination: string | null;
    profession: string | null;
  };
  consent: { version: string; locale: string; at: Date } | null;
  generatedAt: Date;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (d: Date | null) => (d ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : '');
const fmtDateTime = (d: Date) => `${fmtDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;

const row = (fr: string, en: string, value: string | null) =>
  `<tr><th>${esc(fr)}<span>${esc(en)}</span></th><td><bdi dir="auto">${value ? esc(value) : '&nbsp;'}</bdi></td></tr>`;

const DOC_LABEL = { PASSPORT: 'Passeport / Passport', CIN: 'CIN / National ID card' } as const;

export function renderFicheHtml(d: FicheData): string {
  const g = d.guest;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Fiche de police</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Naskh Arabic', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; font-size: 11pt; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  .sub { font-size: 9pt; color: #444; margin-bottom: 6mm; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #111; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 2mm 2mm; border: 1px solid #999; }
  th { width: 38%; font-weight: 600; background: #f3f3f3; }
  th span { display: block; font-weight: 400; font-size: 8.5pt; color: #555; }
  td { min-height: 8mm; }
  .foot { margin-top: 8mm; font-size: 8.5pt; color: #444; line-height: 1.4; }
</style>
</head>
<body>
<h1>Fiche de police <span style="font-weight:400;font-size:12pt">/ Police form</span></h1>
<div class="sub">Mise en forme indicative, à comparer au modèle officiel de la préfecture. / Indicative layout: compare with the official prefecture form.</div>

<h2>Établissement / Establishment</h2>
<table>
${row("Nom de l'établissement", 'Establishment name', d.property.name)}
${row('Adresse', 'Address', d.property.address)}
${row('Commune', 'Commune', d.property.commune)}
</table>

<h2>Séjour / Stay</h2>
<table>
${row("Date d'arrivée", 'Arrival date', fmtDate(d.stay.checkIn))}
${row('Date de départ prévue', 'Planned departure date', fmtDate(d.stay.checkOut))}
</table>

<h2>Voyageur / Traveller${g.guestIndex ? ` ${g.guestIndex}` : ''}</h2>
<table>
${row('Nom et prénoms', 'Full name', g.fullName)}
${row('Date de naissance', 'Date of birth', fmtDate(g.dob))}
${row('Nationalité', 'Nationality', g.nationality)}
${row('Nationalité marocaine déclarée', 'Moroccan nationality declared', g.declaredMoroccanNationality ? 'Oui / Yes' : 'Non / No')}
${row("Type de pièce d'identité", 'Identity document type', g.docType ? DOC_LABEL[g.docType] : null)}
${row('Numéro de la pièce', 'Document number', g.docNumber)}
${row("Date d'expiration de la pièce", 'Document expiry date', fmtDate(g.docExpiryDate))}
${row("Numéro du cachet d'entrée", 'Entry stamp number', g.entryStampNumber)}
${row('Ville de provenance', 'City of origin', g.cityOfOrigin)}
${row('Prochaine destination', 'Next destination', g.nextDestination)}
${row('Profession', 'Profession', g.profession)}
</table>

<div class="foot">
  Établie à partir des déclarations du voyageur; à vérifier par l'établissement.<br>
  Prepared from the traveller's declarations; to be checked by the establishment.<br>
  ${d.consent ? `Consentement enregistré le ${esc(fmtDateTime(d.consent.at))} (texte ${esc(d.consent.version)}, ${esc(d.consent.locale)}). / Consent recorded.<br>` : ''}
  Généré le ${esc(fmtDateTime(d.generatedAt))} · modèle ${esc(TEMPLATE_VERSION)} · réf. ${esc(g.id.slice(0, 8))}
</div>
</body>
</html>`;
}
