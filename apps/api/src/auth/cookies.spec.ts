import type { Response } from 'express';
import { AppConfig } from '../config/env';
import { clearSessionCookies, cookieScheme, setSessionCookies } from './cookies';

function fakeResponse() {
  const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const cleared: { name: string; opts: Record<string, unknown> }[] = [];
  const res = {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => set.push({ name, value, opts }),
    clearCookie: (name: string, opts: Record<string, unknown>) => cleared.push({ name, opts }),
  } as unknown as Response;
  return { res, set, cleared };
}

const config = (secure: boolean) => ({ COOKIE_SECURE: secure, ACCESS_TOKEN_TTL_S: 900, REFRESH_TOKEN_TTL_DAYS: 30 }) as AppConfig;

describe('session cookies', () => {
  it('secure deployments use __Host- cookies: Secure, Path=/, no Domain', () => {
    const { res, set } = fakeResponse();
    setSessionCookies(res, config(true), { access: 'a', refresh: 'r' });

    expect(set.map((c) => c.name)).toEqual(['__Host-dari_at', '__Host-dari_rt']);
    for (const c of set) {
      expect(c.opts).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
      expect(c.opts.domain).toBeUndefined();
    }
  });

  it('plain-HTTP development keeps short names and narrow paths', () => {
    const { res, set } = fakeResponse();
    setSessionCookies(res, config(false), { access: 'a', refresh: 'r' });

    expect(set.map((c) => [c.name, c.opts.path, c.opts.secure])).toEqual([
      ['dari_at', '/api', false],
      ['dari_rt', '/api/auth', false],
    ]);
  });

  it('clears the cookies it set, with the same name and path', () => {
    for (const secure of [true, false]) {
      const { res, cleared } = fakeResponse();
      const scheme = cookieScheme(config(secure));
      clearSessionCookies(res, config(secure));
      expect(cleared.map((c) => [c.name, c.opts.path])).toEqual([
        [scheme.access.name, scheme.access.path],
        [scheme.refresh.name, scheme.refresh.path],
      ]);
    }
  });
});
