import { AppConfig } from '../config/env';
import { mapWorkerResponse, normalizeForCompare, OcrClient, suggestionHashes } from './ocr.client';

const ok = {
  status: 'ok',
  quality: { blurry: false, low_contrast: false },
  format: 'TD3',
  fields: { document_type: 'P', surname: 'ERIKSSON', given_names: 'ANNA MARIA', document_number: 'L898902C3', nationality: 'UTO', birth_date: '1974-08-12', expiry_date: '2012-04-15', sex: 'F', issuing_country: 'UTO' },
  checks: {},
  flagged: [],
  corrected: [],
  unverified: ['surname', 'given_names', 'nationality', 'sex'],
  confidence: 1,
};

describe('mapWorkerResponse', () => {
  it('maps a clean passport read to form suggestions', () => {
    const r = mapWorkerResponse(ok);
    expect(r.status).toBe('ok');
    expect(r.suggestion).toEqual({ docType: 'PASSPORT', fullName: 'ANNA MARIA ERIKSSON', nationality: 'UTO', docNumber: 'L898902C3', dob: '1974-08-12', docExpiryDate: '2012-04-15' });
    expect(r.flagged).toEqual([]);
    expect(r.unverified).toEqual(expect.arrayContaining(['fullName', 'nationality', 'docType']));
    expect(r.quality).toEqual({ blurry: false, lowContrast: false });
  });

  it('flags fields the worker flagged or repaired, and never calls a partial read clean', () => {
    const r = mapWorkerResponse({ ...ok, status: 'partial', flagged: ['birth_date'], corrected: ['document_number'], confidence: 0.6 });
    expect(r.status).toBe('partial');
    expect(r.flagged.sort()).toEqual(['dob', 'docNumber']);
  });

  it('flags a field that was not read at all', () => {
    const r = mapWorkerResponse({ ...ok, fields: { ...ok.fields, birth_date: null } });
    expect(r.suggestion.dob).toBeUndefined();
    expect(r.flagged).toContain('dob');
  });

  it('passes through no_mrz and unreadable, with a fixed reason', () => {
    expect(mapWorkerResponse({ status: 'no_mrz', quality: { blurry: true, low_contrast: false } })).toMatchObject({ status: 'no_mrz', suggestion: {}, quality: { blurry: true } });
    expect(mapWorkerResponse({ status: 'unreadable', reason: 'too_small' })).toMatchObject({ status: 'unreadable', reason: 'too_small' });
    expect(mapWorkerResponse({ status: 'unreadable', reason: '<script>' }).reason).toBe('decode');
  });

  it('treats a malformed answer as unavailable and ignores unexpected or oversized values', () => {
    for (const bad of [null, 'x', 5, [], {}, { status: 'ok' }, { status: 'weird', fields: {} }]) expect(mapWorkerResponse(bad).status).toBe('unavailable');
    const r = mapWorkerResponse({ ...ok, fields: { ...ok.fields, document_number: 'X'.repeat(500) }, extra: '<script>' });
    expect(r.suggestion.docNumber).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('<script>');
  });
});

describe('suggestion hashes', () => {
  it('detect edits without storing values, keyed per draft, and ignore case and spacing', () => {
    const s = { fullName: 'Anna Maria Eriksson', docNumber: 'L898902C3' };
    const a = suggestionHashes(s, 'draft-1');
    expect(JSON.stringify(a)).not.toMatch(/Anna|L898902C3/i);
    expect(a.fullName).toBe(suggestionHashes({ fullName: '  ANNA  MARIA ERIKSSON ' }, 'draft-1').fullName);
    expect(a.fullName).not.toBe(suggestionHashes({ fullName: 'Anna Maria Erikson' }, 'draft-1').fullName);
    expect(a.fullName).not.toBe(suggestionHashes(s, 'draft-2').fullName);
    expect(normalizeForCompare(' é ')).toBe('É');
  });
});

describe('OcrClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const client = (over: Partial<AppConfig> = {}) => new OcrClient({ OCR_SERVICE_URL: 'http://ocr:8001/', OCR_SHARED_SECRET: 's'.repeat(32), ...over } as AppConfig);

  it('is unavailable, without any request, when not configured', async () => {
    const f = jest.fn();
    global.fetch = f as unknown as typeof fetch;
    expect((await client({ OCR_SERVICE_URL: undefined }).extract(Buffer.from('x'))).status).toBe('unavailable');
    expect(f).not.toHaveBeenCalled();
  });

  it('posts the raw image with the shared secret, refusing redirects', async () => {
    const f = jest.fn().mockImplementation(async () => new Response(JSON.stringify(ok), { status: 200 }));
    global.fetch = f as unknown as typeof fetch;
    const r = await client().extract(Buffer.from('jpeg-bytes'));
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://ocr:8001/v1/extract');
    expect(init.headers['x-worker-secret']).toBe('s'.repeat(32));
    expect(init.headers['content-type']).toBe('image/jpeg');
    expect(init.redirect).toBe('error');
    expect(r.status).toBe('ok');
  });

  it('never throws: errors and timeouts become "unavailable"', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    expect((await client().extract(Buffer.from('x'))).status).toBe('unavailable');
    global.fetch = jest.fn().mockImplementation(async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    expect((await client().extract(Buffer.from('x'))).status).toBe('unavailable');
    global.fetch = jest.fn().mockImplementation(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect((await client().extract(Buffer.from('x'))).status).toBe('unavailable');
  });

  it('refuses an oversized answer instead of buffering it', async () => {
    const big = JSON.stringify({ ...ok, padding: 'x'.repeat(200 * 1024) });
    global.fetch = jest.fn().mockImplementation(async () => new Response(big, { status: 200 })) as unknown as typeof fetch;
    expect((await client().extract(Buffer.from('x'))).status).toBe('unavailable');
  });
});
