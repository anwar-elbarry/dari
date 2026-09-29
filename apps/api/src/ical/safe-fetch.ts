import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { AddressPolicy, publicOnly } from './address-policy';

export type FetchErrorCode =
  | 'INVALID_URL'
  | 'INSECURE_SCHEME'
  | 'DNS_FAILED'
  | 'ADDRESS_NOT_ALLOWED'
  | 'TOO_MANY_REDIRECTS'
  | 'HTTP_ERROR'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'NETWORK';

/** Messages never contain the URL or the host: they are stored on the feed and shown to users. */
export class SafeFetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Allow plain http (development fixtures only). */
  allowHttp?: boolean;
  policy?: AddressPolicy;
  lookup?: (host: string) => Promise<string[]>;
  userAgent?: string;
}

export interface SafeFetchResult {
  body: string;
  status: number;
  contentType: string | null;
}

const defaultLookup = async (host: string) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export function validateFeedUrl(raw: string, allowHttp = false): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SafeFetchError('INVALID_URL', 'The link is not a valid URL.');
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new SafeFetchError('INSECURE_SCHEME', 'The link must start with https://.');
  }
  if (url.username || url.password) throw new SafeFetchError('INVALID_URL', 'The link must not contain credentials.');
  if (!url.hostname) throw new SafeFetchError('INVALID_URL', 'The link has no host.');
  return url;
}

/** Resolves the host and returns one address the policy allows; every resolved address must pass. */
export async function resolveAllowed(host: string, policy: AddressPolicy, lookup = defaultLookup): Promise<string> {
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  const addresses = isIP(literal) ? [literal] : await lookup(literal).catch(() => []);
  if (addresses.length === 0) throw new SafeFetchError('DNS_FAILED', 'The host could not be found.');
  if (!addresses.every(policy)) throw new SafeFetchError('ADDRESS_NOT_ALLOWED', 'The host is not reachable from this service.');
  return addresses[0];
}

/**
 * GET a user-supplied URL safely:
 * - https only (http only when explicitly allowed), no credentials in the URL;
 * - the host is resolved first and every address must pass the policy (public only by default);
 * - the socket connects to that checked address (no DNS rebinding between check and connect);
 * - redirects are followed at most `maxRedirects` times and re-checked the same way;
 * - the whole exchange stops after `timeoutMs` and after `maxBytes` of body.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const policy = opts.policy ?? publicOnly;
  const deadline = Date.now() + timeoutMs;

  let url = validateFeedUrl(rawUrl, opts.allowHttp);
  for (let hop = 0; ; hop++) {
    const address = await resolveAllowed(url.hostname, policy, opts.lookup);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError('TIMEOUT', 'The calendar took too long to answer.');

    const res = await request(url, address, remaining, maxBytes, opts.userAgent ?? 'Dari-Calendar-Sync/1.0');
    if (res.redirect) {
      if (hop >= maxRedirects) throw new SafeFetchError('TOO_MANY_REDIRECTS', 'The link redirects too many times.');
      url = validateFeedUrl(new URL(res.redirect, url).toString(), opts.allowHttp);
      continue;
    }
    return { body: res.body!, status: res.status, contentType: res.contentType };
  }
}

interface RawResult {
  status: number;
  contentType: string | null;
  body?: string;
  redirect?: string;
}

function request(url: URL, address: string, timeoutMs: number, maxBytes: number, userAgent: string): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const family = isIP(address);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const fail = (e: unknown) => done(() => reject(wrap(e)));

    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': userAgent, accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
        // Pin the connection to the address that passed the policy; TLS still verifies the hostname (SNI).
        lookup: (_host, _opts, cb) => cb(null, [{ address, family }] as never, family as never),
        timeout: timeoutMs,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = res.headers['content-type'] ?? null;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return done(() => resolve({ status, contentType, redirect: res.headers.location }));
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return fail(new SafeFetchError('HTTP_ERROR', `The calendar answered with an error (HTTP ${status}).`, status));
        }
        const tooLarge = () => {
          fail(new SafeFetchError('TOO_LARGE', 'The calendar file is too large.'));
          res.destroy();
        };
        if (Number(res.headers['content-length'] ?? 0) > maxBytes) return tooLarge();
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return tooLarge();
          chunks.push(chunk);
        });
        res.on('end', () => done(() => resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8') })));
        res.on('error', fail);
      },
    );
    const timeout = () => {
      fail(new SafeFetchError('TIMEOUT', 'The calendar took too long to answer.'));
      req.destroy();
    };
    const timer = setTimeout(timeout, timeoutMs);
    req.on('timeout', timeout);
    req.on('error', fail);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

function wrap(e: unknown): SafeFetchError {
  if (e instanceof SafeFetchError) return e;
  return new SafeFetchError('NETWORK', 'The calendar could not be downloaded.');
}
