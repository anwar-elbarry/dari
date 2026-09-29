import type { CookieOptions, Response } from 'express';
import { AppConfig } from '../config/env';

/**
 * Session cookie names and scope.
 *
 * Secure deployments (production, HTTPS) use `__Host-` cookies: the browser refuses them unless they are
 * Secure, host-only and Path=/, so a sibling subdomain cannot plant or overwrite a session cookie.
 * The price is that `Path=/` sends the refresh cookie to every API route instead of only /api/auth; the
 * API reads it in the auth routes only, and refresh tokens rotate with reuse detection.
 *
 * Plain-HTTP development keeps the short names and narrow paths (browsers refuse `__Host-` without Secure).
 */
export interface CookieScheme {
  access: { name: string; path: string };
  refresh: { name: string; path: string };
}

export function cookieScheme(config: Pick<AppConfig, 'COOKIE_SECURE'>): CookieScheme {
  return config.COOKIE_SECURE
    ? { access: { name: '__Host-dari_at', path: '/' }, refresh: { name: '__Host-dari_rt', path: '/' } }
    : { access: { name: 'dari_at', path: '/api' }, refresh: { name: 'dari_rt', path: '/api/auth' } };
}

function base(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax' };
}

export function setSessionCookies(res: Response, config: AppConfig, tokens: { access: string; refresh: string }) {
  const { access, refresh } = cookieScheme(config);
  res.cookie(access.name, tokens.access, { ...base(config), path: access.path, maxAge: config.ACCESS_TOKEN_TTL_S * 1000 });
  res.cookie(refresh.name, tokens.refresh, { ...base(config), path: refresh.path, maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
}

export function clearSessionCookies(res: Response, config: AppConfig) {
  const { access, refresh } = cookieScheme(config);
  res.clearCookie(access.name, { ...base(config), path: access.path });
  res.clearCookie(refresh.name, { ...base(config), path: refresh.path });
}
