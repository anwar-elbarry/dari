import { RegisterRow } from './register-build';
import { REGISTER_TEMPLATE_VERSION, RegisterData, renderRegisterHtml } from './register-template';

const row = (n: number, over: Partial<RegisterRow['guest']> = {}, continues = false): RegisterRow => ({
  n, bookingId: 'b', checkIn: new Date('2026-10-09T00:00:00Z'), checkOut: new Date('2026-10-12T00:00:00Z'), continuesNextMonth: continues,
  guest: { id: `g${n}`, status: 'VERIFIED', guestIndex: n, docType: 'PASSPORT', fullName: 'Anna Maria Eriksson', nationality: 'SWE', docNumber: 'L898902C3', dob: new Date('1974-08-12T00:00:00Z'), declaredMoroccanNationality: false, entryStampNumber: 'CMN-1', cityOfOrigin: 'Stockholm', nextDestination: 'Essaouira', profession: 'Engineer', ...over },
});
const summary = (problems = 0) => ({ stays: 1, guests: 1, problems, byKind: { NO_CHECKIN: 0, PARTY_INCOMPLETE: 0, DRAFT: 0, MISSING_FIELD: 0, UNVERIFIED: 0 } });
const data = (over: Partial<RegisterData> = {}): RegisterData => ({ property: { name: 'Riad Yasmine', address: '12 Derb', commune: 'Marrakech' }, month: '2026-10', rows: [row(1)], summary: summary(), generatedAt: new Date('2026-11-02T09:31:00Z'), ...over });

describe('renderRegisterHtml', () => {
  it('shows the month, the property, every column and DD/MM/YYYY dates', () => {
    const html = renderRegisterHtml(data());
    for (const t of ['Riad Yasmine', 'Marrakech', '10/2026', '09/10/2026', '12/10/2026', 'Anna Maria Eriksson', '12/08/1974', 'SWE', 'L898902C3', 'CMN-1', 'Stockholm', 'Essaouira', 'Engineer', 'Passeport / Passport', `modèle ${REGISTER_TEMPLATE_VERSION}`, '02/11/2026 09:31 UTC']) expect(html).toContain(t);
    expect(html).toContain('<title>Registre de police</title>');
    expect(html).not.toMatch(/<title>[^<]*(Eriksson|Yasmine)/);
  });

  it('escapes every value', () => {
    const evil = `<script>alert(1)</script><img src="http://evil.test/x" onerror="x()">"&'`;
    const html = renderRegisterHtml(data({ property: { name: evil, address: evil, commune: evil }, rows: [row(1, { fullName: evil, nationality: evil, docNumber: evil, entryStampNumber: evil, cityOfOrigin: evil, nextDestination: evil, profession: evil })] }));
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src="http://evil.test');
    expect(html).not.toMatch(/onerror="/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('warns on the page when records were incomplete, and not otherwise', () => {
    expect(renderRegisterHtml(data({ summary: summary(3) }))).toContain('3 point(s) incomplet(s)');
    expect(renderRegisterHtml(data())).not.toContain('incomplet(s)');
  });

  it('notes a stay that continues into the next month, only when there is one', () => {
    expect(renderRegisterHtml(data({ rows: [row(1, {}, true)] }))).toContain('† Séjour se poursuivant');
    expect(renderRegisterHtml(data())).not.toContain('†');
  });

  it('says so when the month has no guest', () => {
    expect(renderRegisterHtml(data({ rows: [], summary: { ...summary(), guests: 0 } }))).toContain('Aucun voyageur enregistré');
  });

  it('never claims compliance or certification, and calls the layout indicative', () => {
    const html = renderRegisterHtml(data({ summary: summary(2), rows: [row(1, {}, true)] }));
    expect(html).not.toMatch(/certifi|certified|conforme|compliant|compliance|approuv|approved|garanti|guarantee|DGSN|laid out like/i);
    expect(html).toContain('Mise en forme indicative');
    expect(html).toContain('compare with the official prefecture form');
  });

  it('has no script, no external resource and a locked-down policy', () => {
    const html = renderRegisterHtml(data());
    expect(html).not.toMatch(/<script|<img|<link|<iframe|src=|url\(|@import|https?:\/\//i);
    expect(html).toContain(`default-src 'none'`);
  });
});
