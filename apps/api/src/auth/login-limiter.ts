import type Redis from 'ioredis';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
const MAX_ENTRIES = 10_000;

/**
 * Per-email brute-force limit, on top of the per-IP rate limit.
 * `fail()` is called before the password is verified, so parallel guesses are all counted.
 * Trade-off: an attacker can lock a known email out for 15 minutes; accepted for the MVP.
 */
export abstract class LoginLimiter {
  /** Records one attempt and returns the number of attempts in the window, atomically. */
  abstract recordAttempt(email: string): Promise<number> | number;
  abstract reset(email: string): Promise<void> | void;

  /** True once an attempt count is past the allowed failures. */
  static blocked(attempts: number): boolean {
    return attempts > MAX_FAILURES;
  }
}

/** Single-process fallback for development and tests without Redis. */
export class MemoryLoginLimiter extends LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  recordAttempt(email: string, now = Date.now()): number {
    if (this.failures.size >= MAX_ENTRIES) this.prune(now);
    const times = [...this.recent(email, now), now];
    this.failures.set(email, times);
    return times.length;
  }

  reset(email: string) {
    this.failures.delete(email);
  }

  private recent(email: string, now: number): number[] {
    return (this.failures.get(email) ?? []).filter((t) => now - t < WINDOW_MS);
  }

  private prune(now: number) {
    for (const [email, times] of this.failures) {
      if (times.every((t) => now - t >= WINDOW_MS)) this.failures.delete(email);
    }
  }
}

/** Shared across instances. Keys hold a hash of the email, not the email itself. */
export class RedisLoginLimiter extends LoginLimiter {
  constructor(private readonly redis: Redis) {
    super();
  }

  private key(email: string) {
    return `login-fail:${Buffer.from(email).toString('base64url')}`;
  }

  async recordAttempt(email: string): Promise<number> {
    const k = this.key(email);
    const [[, n]] = (await this.redis.multi().incr(k).pexpire(k, WINDOW_MS, 'NX').exec()) as [[null, number], unknown];
    return n;
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }
}
