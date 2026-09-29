import { esc, fmtDate, FicheData, renderFicheHtml, TEMPLATE_VERSION } from './fiche-template';

const data = (over: Partial<FicheData['guest']> = {}, property: Partial<FicheData['property']> = {}): FicheData => ({
  property: { name: 'Riad Yasmine', address: '12 Derb Sidi Bouamar, Médina', commune: 'Marrakech', ...property },
  stay: { checkIn: new Date('2026-10-09T00:00:00Z'), checkOut: new Date('2026-10-12T00:00:00Z') },
  guest: {
    id: '3f2b8c1e-9d4a-4c7e-8a55-1b2c3d4e5f60',
    guestIndex: 2,
    docType: 'PASSPORT',
    fullName: 'Anna Maria Eriksson',
    nationality: 'SWE',
    docNumber: 'L898902C3',
    dob: new Date('1974-08-12T00:00:00Z'),
    docExpiryDate: new Date('2030-04-15T00:00:00Z'),
    declaredMoroccanNationality: false,
    entryStampNumber: 'CMN-2026-001',
    cityOfOrigin: 'Stockholm',
    nextDestination: 'Essaouira',
    profession: 'Engineer',
    ...over,
  },
  consent: { version: 'v1', locale: 'fr', at: new Date('2026-10-01T09:30:00Z') },
  generatedAt: new Date('2026-10-01T09:31:00Z'),
});

describe('renderFicheHtml', () => {
  it('shows every field, with French and English labels and DD/MM/YYYY dates', () => {
    const html = renderFicheHtml(data());
    for (const text of ['Riad Yasmine', 'Marrakech', '09/10/2026', '12/10/2026', 'Anna Maria Eriksson', '12/08/1974', 'SWE', 'L898902C3', '15/04/2030', 'CMN-2026-001', 'Stockholm', 'Essaouira', 'Engineer']) {
      expect(html).toContain(text);
    }
    for (const label of ['Nom et prénoms', 'Full name', 'Numéro du cachet d&#39;entrée', 'Entry stamp number', 'Ville de provenance', 'Prochaine destination', 'Profession', 'Passeport / Passport']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Voyageur / Traveller 2');
    expect(html).toContain('Non / No'); // the Moroccan-nationality declaration
  });

  it('records the template version, the consent and a short reference, but no identifying title', () => {
    const html = renderFicheHtml(data());
    expect(html).toContain(`modèle ${TEMPLATE_VERSION}`);
    expect(html).toContain('01/10/2026 09:30 UTC');
    expect(html).toContain('réf. 3f2b8c1e');
    expect(html).toContain('<title>Fiche de police</title>'); // the PDF title carries no name
    expect(html).not.toMatch(/<title>[^<]*Eriksson/);
  });

  it('escapes every value: nothing a guest or a manager typed can become markup', () => {
    const evil = `<script>alert(1)</script><img src="http://evil.test/x" onerror="x()">"&'`;
    const html = renderFicheHtml(
      data(
        { fullName: evil, nationality: evil, docNumber: evil, entryStampNumber: evil, cityOfOrigin: evil, nextDestination: evil, profession: evil },
        { name: evil, address: evil, commune: evil },
      ),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src="http://evil.test');
    expect(html).not.toMatch(/onerror="/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('is a static document: no script, no external resource, and a policy that forbids them', () => {
    const html = renderFicheHtml(data());
    expect(html).not.toMatch(/<script|<img|<link|<iframe|<object|<embed|src=|href=|@import|url\(/i);
    expect(html).toContain("default-src 'none'");
  });

  it('never claims compliance, certification, approval or a guarantee (rule 2 in CLAUDE.md)', () => {
    const html = renderFicheHtml(data());
    expect(html).not.toMatch(/certif|garanti|guarant|complian|conforme|conformément|approuv|approved|officiel(le)? de la DGSN|DGSN/i);
    // It does say what it is: an indicative layout, built from the traveller's declaration.
    expect(html).toContain('Mise en forme indicative');
    expect(html).toContain("déclarations du voyageur");
  });

  it('keeps Arabic and Latin values readable in either direction (dir=auto) and tolerates missing values', () => {
    const html = renderFicheHtml(data({ fullName: 'محمد بن عبد الله', profession: null, docExpiryDate: null, docType: null }));
    expect(html).toContain('محمد بن عبد الله');
    expect(html).toContain('<bdi dir="auto">');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('formats dates in UTC', () => {
    expect(fmtDate(new Date('2026-01-05T23:30:00Z'))).toBe('05/01/2026');
    expect(fmtDate(null)).toBe('');
  });
});
