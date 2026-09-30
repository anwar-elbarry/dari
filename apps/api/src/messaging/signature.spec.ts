import { parseStatusReports, sign, verifySignature } from './signature';

const SECRET = 'app-secret-for-tests-0123456789';
const body = Buffer.from(JSON.stringify({ hello: 'world' }));

describe('verifySignature', () => {
  it('accepts the right signature and refuses everything else', () => {
    expect(verifySignature(body, sign(body, SECRET), SECRET)).toBe(true);
    expect(verifySignature(body, sign(body, 'another-secret-0123456789'), SECRET)).toBe(false);
    expect(verifySignature(Buffer.from('{"hello":"WORLD"}'), sign(body, SECRET), SECRET)).toBe(false);
    for (const bad of [undefined, '', 'sha256=', 'sha256=zz', 'sha1=abcd', sign(body, SECRET).slice(7), `${sign(body, SECRET)}00`]) {
      expect(verifySignature(body, bad, SECRET)).toBe(false);
    }
  });
});

describe('parseStatusReports', () => {
  const payload = (statuses: unknown[]) => ({ entry: [{ changes: [{ value: { statuses, messages: [{ from: '212600000000', text: { body: 'private' } }] } }] }] });

  it('keeps the id and the status, and nothing else', () => {
    const r = parseStatusReports(payload([{ id: 'wamid.1', status: 'delivered', recipient_id: '212600000000', errors: [{ title: 'x' }] }, { id: 'wamid.2', status: 'read' }]));
    expect(r).toEqual([{ providerMessageId: 'wamid.1', status: 'DELIVERED' }, { providerMessageId: 'wamid.2', status: 'READ' }]);
    expect(JSON.stringify(r)).not.toMatch(/212600000000|private/);
  });

  it('ignores unknown statuses, malformed entries and oversized ids; caps the count', () => {
    expect(parseStatusReports(payload([{ id: 'a', status: 'weird' }, { id: 5, status: 'sent' }, { status: 'sent' }, null, { id: 'x'.repeat(300), status: 'sent' }]))).toEqual([]);
    expect(parseStatusReports(payload(Array.from({ length: 500 }, (_, i) => ({ id: `w${i}`, status: 'sent' }))))).toHaveLength(200);
    for (const junk of [null, 'x', [], {}, { entry: 'x' }, { entry: [null, { changes: 'x' }] }]) expect(parseStatusReports(junk)).toEqual([]);
  });
});
