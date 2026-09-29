import type Redis from 'ioredis';

/**
 * Counts events per key in a sliding-ish window (fixed window that starts at the first hit).
 * Used for per-token abuse caps on top of the per-IP rate limit. Redis when available (shared across
 * instances), in-memory otherwise (development and tests). Keys are opaque hashes, never personal data.
 */
export abstract class WindowCounter {
  /** Records one hit and returns the number of hits in the current window, atomically. */
  abstract hit(key: string, windowMs: number): Promise<number>;
}

export class MemoryWindowCounter extends WindowCounter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number, now = Date.now()): Promise<number> {
    if (this.entries.size > 10_000) for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    current.count += 1;
    return current.count;
  }
}

export class RedisWindowCounter extends WindowCounter {
  constructor(private readonly redis: Redis) {
    super();
  }

  async hit(key: string, windowMs: number): Promise<number> {
    const k = `win:${key}`;
    const [[, n]] = (await this.redis.multi().incr(k).pexpire(k, windowMs, 'NX').exec()) as [[null, number], unknown];
    return n;
  }
}
