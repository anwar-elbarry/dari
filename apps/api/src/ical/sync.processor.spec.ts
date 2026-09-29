import { feedJobId } from './sync.processor';

describe('feedJobId', () => {
  const hour = 3_600_000;

  it('is accepted by BullMQ: no colon, only safe characters', () => {
    expect(feedJobId('7d3c1f0e-9c39-4f31-a1b5-0c6c1f0e9c39', 2 * hour, 1_790_000_000_000)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is the same inside one interval and different in the next', () => {
    const t0 = 1_790_000_000_000;
    const a = feedJobId('f1', 2 * hour, t0);
    expect(feedJobId('f1', 2 * hour, t0 + 60_000)).toBe(a);
    expect(feedJobId('f1', 2 * hour, t0 + 3 * hour)).not.toBe(a);
    expect(feedJobId('f2', 2 * hour, t0)).not.toBe(a);
  });
});
