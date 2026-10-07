/* Small maths for the hand-made dashboard charts (no chart library). */

/** Top of a value axis: the smallest of 1, 2, 5 × 10^k that is at least `n` (1 for an empty series). */
export function niceMax(n: number): number {
  if (!(n > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/** Gridline values from 0 to `max`, whole numbers only. */
export function ticks(max: number): number[] {
  return max >= 2 && max % 2 === 0 ? [0, max / 2, max] : [0, max];
}

/** Donut segments as fractions of the whole: where each starts and how much it takes. Nothing for an empty total. */
export function segments(values: number[]): { start: number; size: number }[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => ({ start: 0, size: 0 }));
  let start = 0;
  return values.map((v) => {
    const s = { start, size: v / total };
    start += s.size;
    return s;
  });
}
