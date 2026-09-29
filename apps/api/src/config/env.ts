import { z } from 'zod';

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
    /** console / file are development and test drivers: they expose single-use links. */
    MAIL_DRIVER: z.enum(['console', 'file']).default('console'),
    MAIL_FILE_DIR: z.string().default('.mail'),
    MAIL_FROM: z.string().min(3).default('Dari <no-reply@localhost>'),
    /** Tests turn this off so many requests from one IP do not trip the limits; refused off in production. */
    RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    /** Calendar sync: interval, fetch caps, and a dev/test switch that allows http and private hosts. */
    ICAL_SYNC_INTERVAL_HOURS: z.coerce.number().int().min(1).max(24).default(2),
    ICAL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    ICAL_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
    ICAL_ALLOW_INSECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .superRefine((env, ctx) => {
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
  .transform(({ COOKIE_SECURE, ...env }) => ({
    ...env,
    COOKIE_SECURE: COOKIE_SECURE === undefined ? env.NODE_ENV === 'production' : COOKIE_SECURE === 'true',
  }));

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
