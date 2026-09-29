import http from 'node:http';
import { AddressInfo } from 'node:net';
import { resolveAllowed, safeFetch, SafeFetchError, validateFeedUrl } from './safe-fetch';
import { publicOnly } from './address-policy';

/** Test policy: only 127.0.0.1 is allowed, so a redirect to 127.0.0.2 proves re-validation on redirect. */
const loopbackOnly = (ip: string) => ip === '127.0.0.1';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof SafeFetchError) return e.code;
    throw e;
  }
}

describe('validateFeedUrl', () => {
  it('accepts https and refuses everything else', () => {
    expect(validateFeedUrl('https://example.test/cal.ics').hostname).toBe('example.test');
    expect(() => validateFeedUrl('http://example.test/cal.ics')).toThrow(SafeFetchError);
    expect(validateFeedUrl('http://example.test/cal.ics', true).protocol).toBe('http:');
    for (const bad of ['ftp://example.test/x', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'https://user:pw@example.test/x']) {
      expect(() => validateFeedUrl(bad, true)).toThrow(SafeFetchError);
    }
  });
});

describe('resolveAllowed', () => {
  it('refuses a name that resolves to a private address, even alongside a public one', async () => {
    const lookup = async () => ['93.184.216.34', '10.0.0.5'];
    await expect(resolveAllowed('rebind.test', publicOnly, lookup)).rejects.toMatchObject({ code: 'ADDRESS_NOT_ALLOWED' });
  });

  it('refuses IP literals and unresolvable names', async () => {
    await expect(resolveAllowed('169.254.169.254', publicOnly)).rejects.toMatchObject({ code: 'ADDRESS_NOT_ALLOWED' });
    await expect(resolveAllowed('[::1]', publicOnly)).rejects.toMatchObject({ code: 'ADDRESS_NOT_ALLOWED' });
    await expect(resolveAllowed('nope.invalid', publicOnly, async () => [])).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });

  it('returns the first address when all pass', async () => {
    expect(await resolveAllowed('ok.test', publicOnly, async () => ['8.8.8.8', '1.1.1.1'])).toBe('8.8.8.8');
  });

  it('error messages never contain the host', async () => {
    const err = (await resolveAllowed('secret-host.test', publicOnly, async () => ['127.0.0.1']).catch((e: unknown) => e)) as SafeFetchError;
    expect(err.message).not.toContain('secret-host');
  });
});

describe('safeFetch against a local server', () => {
  let server: http.Server;
  let base: string;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      switch (u.pathname) {
        case '/ok':
          res.setHeader('content-type', 'text/calendar');
          return res.end('BEGIN:VCALENDAR\nEND:VCALENDAR');
        case '/redirect':
          res.writeHead(302, { location: '/ok' });
          return res.end();
        case '/redirect-private':
          res.writeHead(302, { location: `http://127.0.0.2:${port}/ok` });
          return res.end();
        case '/loop':
          res.writeHead(302, { location: '/loop' });
          return res.end();
        case '/big':
          res.setHeader('content-type', 'text/calendar');
          res.write('x'.repeat(1024));
          res.write('y'.repeat(1024));
          return res.end('z'.repeat(1024));
        case '/big-declared':
          res.writeHead(200, { 'content-length': '999999', 'content-type': 'text/calendar' });
          return res.end('x'.repeat(10));
        case '/slow':
          return setTimeout(() => res.end('late'), 2_000);
        case '/missing':
          res.writeHead(404);
          return res.end('no');
        default:
          res.writeHead(500);
          return res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const opts = { allowHttp: true, policy: loopbackOnly, timeoutMs: 1_000, maxBytes: 2048 };

  it('downloads a calendar', async () => {
    const r = await safeFetch(`${base}/ok`, opts);
    expect(r.status).toBe(200);
    expect(r.body).toContain('VCALENDAR');
    expect(r.contentType).toBe('text/calendar');
  });

  it('follows a same-host redirect and re-checks the target address', async () => {
    expect(await code(safeFetch(`${base}/redirect`, opts))).toBe('OK');
    expect(await code(safeFetch(`${base}/redirect-private`, opts))).toBe('ADDRESS_NOT_ALLOWED');
    expect(await code(safeFetch(`${base}/loop`, opts))).toBe('TOO_MANY_REDIRECTS');
  });

  it('stops oversized bodies, declared or streamed', async () => {
    expect(await code(safeFetch(`${base}/big`, opts))).toBe('TOO_LARGE');
    expect(await code(safeFetch(`${base}/big-declared`, opts))).toBe('TOO_LARGE');
  });

  it('times out and reports HTTP errors without the URL', async () => {
    expect(await code(safeFetch(`${base}/slow`, opts))).toBe('TIMEOUT');
    const err = (await safeFetch(`${base}/missing`, opts).catch((e: unknown) => e)) as SafeFetchError;
    expect(err).toMatchObject({ code: 'HTTP_ERROR', status: 404 });
    expect(err.message).not.toContain('127.0.0.1');
  });

  it('refuses http and loopback with the default settings', async () => {
    expect(await code(safeFetch(`${base}/ok`))).toBe('INSECURE_SCHEME');
    expect(await code(safeFetch(`${base}/ok`, { allowHttp: true }))).toBe('ADDRESS_NOT_ALLOWED');
  });
});
