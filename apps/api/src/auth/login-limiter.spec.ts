import { LoginLimiter, MemoryLoginLimiter } from './login-limiter';

describe('MemoryLoginLimiter', () => {
  it('blocks after 5 failures within 15 minutes and unblocks after the window', () => {
    const l = new MemoryLoginLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(LoginLimiter.blocked(l.recordAttempt('a@b.test', t0 + i))).toBe(false);
    expect(LoginLimiter.blocked(l.recordAttempt('a@b.test', t0 + 10))).toBe(true);
    expect(LoginLimiter.blocked(l.recordAttempt('a@b.test', t0 + 15 * 60_000 + 11))).toBe(false);
  });

  it('is per email and cleared by a success', () => {
    const l = new MemoryLoginLimiter();
    for (let i = 0; i < 6; i++) l.recordAttempt('a@b.test');
    expect(LoginLimiter.blocked(l.recordAttempt('c@d.test'))).toBe(false);
    l.reset('a@b.test');
    expect(LoginLimiter.blocked(l.recordAttempt('a@b.test'))).toBe(false);
  });
});
