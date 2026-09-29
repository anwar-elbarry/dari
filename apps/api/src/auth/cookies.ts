import type { CookieOptions, Response } from 'express';
import { AppConfig } from '../config/env';

export const ACCESS_COOKIE = 'dari_at';
export const REFRESH_COOKIE = 'dari_rt';

/** The refresh cookie is only sent to the auth endpoints, never to the rest of the API. */
const REFRESH_PATH = '/api/auth';
const ACCESS_PATH = '/api';

function base(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax' };
}

export function setSessionCookies(res: Response, config: AppConfig, tokens: { access: string; refresh: string }) {
  res.cookie(ACCESS_COOKIE, tokens.access, {
    ...base(config),
    path: ACCESS_PATH,
    maxAge: config.ACCESS_TOKEN_TTL_S * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...base(config),
    path: REFRESH_PATH,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearSessionCookies(res: Response, config: AppConfig) {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...base(config), path: REFRESH_PATH });
}
