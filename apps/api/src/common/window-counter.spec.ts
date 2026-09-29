import { MemoryWindowCounter } from './window-counter';

describe('MemoryWindowCounter', () => {
  it('counts per key inside a window and starts over after it', async () => {
    const c = new MemoryWindowCounter();
    expect(await c.hit('a', 1000, 0)).toBe(1);
    expect(await c.hit('a', 1000, 500)).toBe(2);
    expect(await c.hit('b', 1000, 500)).toBe(1);
    expect(await c.hit('a', 1000, 1001)).toBe(1);
  });
});
