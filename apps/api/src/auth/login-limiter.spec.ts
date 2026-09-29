import { LoginLimiter } from './login-limiter';

describe('LoginLimiter', () => {
  it('blocks after 5 failures within 15 minutes and unblocks after the window', () => {
    const l = new LoginLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) l.fail('a@b.test', t0 + i);
    expect(l.isBlocked('a@b.test', t0 + 10)).toBe(false);
    l.fail('a@b.test', t0 + 10);
    expect(l.isBlocked('a@b.test', t0 + 11)).toBe(true);
    expect(l.isBlocked('a@b.test', t0 + 15 * 60_000 + 11)).toBe(false);
  });

  it('is per email and cleared by a success', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 5; i++) l.fail('a@b.test');
    expect(l.isBlocked('c@d.test')).toBe(false);
    l.reset('a@b.test');
    expect(l.isBlocked('a@b.test')).toBe(false);
  });
});
