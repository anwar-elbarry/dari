import { z } from 'zod';
import { KeyringError, parseKeyring } from '../storage/envelope';

/**
 * Environment contract. Parsed once at boot; the app refuses to start on an invalid value
 * so a misconfiguration fails loudly instead of running with a silent default.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().url(),
    /**
     * Redis: job queue, rate-limit counters and login lockout. Optional in development and test
     * (in-memory fallbacks, single process only); required in production.
     */
    REDIS_URL: z.string().url().optional(),
    /** Public URL of the web app, used to build links in emails (reset, invitations). */
    APP_URL: z.string().url().default('http://localhost:3000'),
    /**
     * Number of reverse-proxy hops in front of the API (Next.js /api proxy, load balancer).
     * Must be right, or rate limiting and audit IPs see the proxy address instead of the client.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    /** Signs the short-lived access token. At least 32 characters; rotate by redeploying (all sessions must refresh). */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_S: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    PASSWORD_RESET_TTL_MIN: z.coerce.number().int().positive().default(60),
    INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    /** Secure cookies (HTTPS only). Defaults to true in production and false otherwise; cannot be false in production. */
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    /**
     * console / file are development and test drivers: they expose single-use links.
     * resend is the production driver (Resend is a US provider: covered by the cross-border position in docs/phase-3.md).
     */
    MAIL_DRIVER: z.enum(['console', 'file', 'resend']).default('console'),
    /** API key of the mail provider. Required for resend; never logged. */
    MAIL_API_KEY: z.string().min(8).optional(),
    MAIL_FILE_DIR: z.string().default('.mail'),
    MAIL_FROM: z.string().min(3).default('Dari <no-reply@localhost>'),
    /** Tests turn this off so many requests from one IP do not trip the limits; refused off in production. */
    RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    /** Calendar sync: interval, fetch caps, and a dev/test switch that allows http and private hosts. */
    ICAL_SYNC_INTERVAL_HOURS: z.coerce.number().int().min(1).max(24).default(2),
    ICAL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    ICAL_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
    ICAL_ALLOW_INSECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    /**
     * Guest check-in and Fiche de Police (Phase 3). Off by default in production: it stays off until the legal
     * gates are closed (CNDP, hosting, consent wording). On by default elsewhere so development and tests work.
     */
    GUEST_CHECKIN_ENABLED: z.enum(['true', 'false']).optional(),
    /**
     * Phase 4: the monthly police register and Secure Share. Same rule as the guest feature: on by default
     * outside production, off in production until the legal gates are closed. Both store or read encrypted
     * PDFs, so turning either on in production requires the storage settings.
     */
    POLICE_REGISTER_ENABLED: z.enum(['true', 'false']).optional(),
    SECURE_SHARE_ENABLED: z.enum(['true', 'false']).optional(),
    /**
     * Phase 5: monthly tax estimates, PDF and Excel exports, Accountant reports. Same rule: on outside production,
     * off in production. Reports are stored as encrypted files, so turning it on in production needs the storage settings.
     */
    TAX_REPORTS_ENABLED: z.enum(['true', 'false']).optional(),
    /**
     * Phase 6: WhatsApp Cloud API delivery of check-in links, alerts and share links (with e-mail as the fallback).
     * Same rule: on outside production, off in production until Meta's verification, the approved templates and
     * the CNDP position on Meta as a recipient are in place. The provider settings arrive with the driver (6.4).
     */
    WHATSAPP_ENABLED: z.enum(['true', 'false']).optional(),
    /**
     * Public self-service signup (`POST /api/auth/signup`). On outside production, off in production: pilot accounts
     * are created by the operator until e-mail verification exists (docs/phase-7.md). Off answers 403 SIGNUP_CLOSED.
     */
    SIGNUP_ENABLED: z.enum(['true', 'false']).optional(),
    /**
     * `stub` records messages in memory and sends nothing (development and tests only: refused in production once
     * WhatsApp is on). `cloud` is Meta's WhatsApp Cloud API. The secrets live in the secret store, never in the repo.
     */
    WHATSAPP_DRIVER: z.enum(['stub', 'cloud']).default('stub'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(5).optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
    /** Signs Meta's delivery reports (X-Hub-Signature-256). Without it the webhook answers 404. */
    WHATSAPP_APP_SECRET: z.string().min(16).optional(),
    /** Echoed back once, when the webhook is registered in Meta's console. */
    WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
    WHATSAPP_API_VERSION: z.string().regex(/^v\d{1,2}\.\d{1,2}$/).default('v21.0'),
    /**
     * Private object storage for ID scans and Fiche PDFs (Phase 3). `memory` is dev/test only (refused in
     * production). Everything is encrypted by the application before it reaches the store, so the provider
     * only ever holds ciphertext; S3_SSE adds provider-side encryption on top.
     */
    STORAGE_DRIVER: z.enum(['memory', 's3']).default('memory'),
    /**
     * Master keys that wrap the per-object data keys: `id:base64,id:base64`, newest first (openssl rand -base64 32).
     * Required in production and with the s3 driver. Outside production the memory driver runs with an
     * ephemeral key when unset. From the secret store, never the repository.
     */
    STORAGE_MASTER_KEYS: z.string().optional(),
    /**
     * Document worker (services/ocr) on the private network. Optional: without it the guest types the fields
     * (OCR is assistive). The secret must be 32+ characters and is sent in `X-Worker-Secret`.
     */
    /** Where the retention job reports a failed or overdue purge (counts only, no personal data). Optional. */
    OPS_ALERT_EMAIL: z.string().email().optional(),
    /**
     * Headless Chromium that renders the Fiche de Police PDF. Path to the binary (default: Playwright's own).
     * PDF_NO_SANDBOX is only for containers that cannot give Chromium a sandbox: the renderer loads our own
     * escaped HTML with JavaScript off and the network blocked, but prefer a non-root user with the sandbox.
     */
    PDF_CHROMIUM_PATH: z.string().min(1).optional(),
    PDF_NO_SANDBOX: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    OCR_SERVICE_URL: z.string().url().optional(),
    OCR_SHARED_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    STORAGE_MAX_BYTES: z.coerce.number().int().positive().default(16 * 1024 * 1024),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3).optional(),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    S3_SSE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.OCR_SERVICE_URL && !isInternalOrHttps(env.OCR_SERVICE_URL)) {
      ctx.addIssue({ code: 'custom', path: ['OCR_SERVICE_URL'], message: 'must be https, or http to a private host (an ID image and the shared secret travel in clear otherwise)' });
    }
    if (env.OCR_SERVICE_URL && !env.OCR_SHARED_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['OCR_SHARED_SECRET'], message: 'required with OCR_SERVICE_URL' });
    }
    if (env.STORAGE_MASTER_KEYS) {
      try {
        parseKeyring(env.STORAGE_MASTER_KEYS);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_MASTER_KEYS'], message: e instanceof KeyringError ? e.message : 'invalid' });
      }
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'STORAGE_MASTER_KEYS'] as const) {
        if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'required with the s3 storage driver' });
      }
    }
    // Storage holds ID images, PDFs and licence documents. Licence documents are uploaded whatever the guest flags say,
    // so production always needs the private, encrypted store: `memory` would lose them at the next restart (7.2 finding).
    if (env.NODE_ENV === 'production') {
      if (env.STORAGE_DRIVER !== 's3') ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'must be s3 in production (private, encrypted object storage)' });
      if (!env.STORAGE_MASTER_KEYS) ctx.addIssue({ code: 'custom', path: ['STORAGE_MASTER_KEYS'], message: 'required in production' });
      if (!env.S3_SSE) ctx.addIssue({ code: 'custom', path: ['S3_SSE'], message: 'server-side encryption must be enabled in production' });
      if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'must be https in production' });
    }
    if (env.WHATSAPP_DRIVER === 'cloud') {
      for (const key of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required with the cloud WhatsApp driver' });
      }
    }
    if (env.NODE_ENV === 'production' && env.WHATSAPP_ENABLED === 'true' && env.WHATSAPP_DRIVER !== 'cloud') {
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_DRIVER'], message: 'must be cloud in production when WhatsApp is enabled' });
    }
    if (env.MAIL_DRIVER === 'resend' && !env.MAIL_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_API_KEY'], message: `required with the ${env.MAIL_DRIVER} mail driver` });
    }
    // The console driver prints message bodies (reset and invitation links) — development only.
    if (env.NODE_ENV === 'production' && (env.MAIL_DRIVER === 'console' || env.MAIL_DRIVER === 'file')) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: `${env.MAIL_DRIVER} mail driver is not allowed in production`,
      });
    }
    if (env.NODE_ENV === 'production' && (env.JWT_ACCESS_SECRET.length < 43 || /change-?me|example|placeholder|secret/i.test(env.JWT_ACCESS_SECRET))) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'must be a random value of at least 43 characters in production (openssl rand -base64 48)' });
    }
    if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
      ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'required in production (rate limits, lockout and jobs must be shared)' });
    }
    if (env.NODE_ENV === 'production' && env.ICAL_ALLOW_INSECURE) {
      ctx.addIssue({ code: 'custom', path: ['ICAL_ALLOW_INSECURE'], message: 'insecure calendar fetching cannot be enabled in production' });
    }
    if (env.NODE_ENV === 'production' && !env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_ENABLED'], message: 'rate limiting cannot be disabled in production' });
    }
    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'cookies must be secure in production' });
    }
  })
  .transform(({ COOKIE_SECURE, GUEST_CHECKIN_ENABLED, POLICE_REGISTER_ENABLED, SECURE_SHARE_ENABLED, TAX_REPORTS_ENABLED, WHATSAPP_ENABLED, SIGNUP_ENABLED, ...env }) => ({
    ...env,
    COOKIE_SECURE: COOKIE_SECURE === undefined ? env.NODE_ENV === 'production' : COOKIE_SECURE === 'true',
    GUEST_CHECKIN_ENABLED: GUEST_CHECKIN_ENABLED === undefined ? env.NODE_ENV !== 'production' : GUEST_CHECKIN_ENABLED === 'true',
    POLICE_REGISTER_ENABLED: POLICE_REGISTER_ENABLED === undefined ? env.NODE_ENV !== 'production' : POLICE_REGISTER_ENABLED === 'true',
    SECURE_SHARE_ENABLED: SECURE_SHARE_ENABLED === undefined ? env.NODE_ENV !== 'production' : SECURE_SHARE_ENABLED === 'true',
    TAX_REPORTS_ENABLED: TAX_REPORTS_ENABLED === undefined ? env.NODE_ENV !== 'production' : TAX_REPORTS_ENABLED === 'true',
    WHATSAPP_ENABLED: WHATSAPP_ENABLED === undefined ? env.NODE_ENV !== 'production' : WHATSAPP_ENABLED === 'true',
    SIGNUP_ENABLED: SIGNUP_ENABLED === undefined ? env.NODE_ENV !== 'production' : SIGNUP_ENABLED === 'true',
  }));

/** https, or plain http only to a host that is not on the internet: a bare service name, localhost, a private IPv4 or *.internal/*.local/*.svc. */
export function isInternalOrHttps(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  const h = u.hostname;
  if (h === 'localhost' || /^[a-z0-9-]+$/i.test(h) || /\.(internal|local|svc|svc\.cluster\.local)$/i.test(h)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export type AppConfig = z.infer<typeof envSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function parseEnv(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Report variable names and reasons only, never values (they may be secrets).
    const issues = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
