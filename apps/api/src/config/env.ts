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
    /** Public URL of the web app, used to build links in emails (reset, invitations). */
    APP_URL: z.string().url().default('http://localhost:3000'),
    /**
     * Number of reverse-proxy hops in front of the API (Next.js /api proxy, load balancer).
     * Must be right, or rate limiting and audit IPs see the proxy address instead of the client.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    MAIL_DRIVER: z.enum(['console']).default('console'),
    MAIL_FROM: z.string().min(3).default('Dari <no-reply@localhost>'),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .superRefine((env, ctx) => {
    // The console driver prints message bodies (reset and invitation links) — development only.
    if (env.NODE_ENV === 'production' && env.MAIL_DRIVER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: 'console mail driver is not allowed in production',
      });
    }
  });

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
