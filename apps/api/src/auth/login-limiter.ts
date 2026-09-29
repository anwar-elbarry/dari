import { Injectable } from '@nestjs/common';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const MAX_ENTRIES = 10_000;

/**
 * Per-email brute-force limit, on top of the per-IP rate limit.
 * In-memory: correct for a single API instance. Move to Redis before running several instances.
 * Trade-off: an attacker can lock a known email out for 15 minutes; accepted for the MVP.
 */
@Injectable()
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  isBlocked(email: string, now = Date.now()): boolean {
    return this.recent(email, now).length >= MAX_FAILURES;
  }

  fail(email: string, now = Date.now()) {
    if (this.failures.size >= MAX_ENTRIES) this.prune(now);
    this.failures.set(email, [...this.recent(email, now), now]);
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
