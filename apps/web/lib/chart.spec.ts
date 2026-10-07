import { niceMax, segments, ticks } from './chart';

describe('niceMax', () => {
  it.each([
    [0, 1],
    [1, 1],
    [3, 5],
    [7, 10],
    [12, 20],
    [31, 50],
    [50, 50],
    [120, 200],
  ])('%d → %d', (n, max) => expect(niceMax(n)).toBe(max));
});

describe('ticks', () => {
  it('halves an even top, keeps whole numbers otherwise', () => {
    expect(ticks(20)).toEqual([0, 10, 20]);
    expect(ticks(5)).toEqual([0, 5]);
    expect(ticks(1)).toEqual([0, 1]);
  });
});

describe('segments', () => {
  it('turns values into consecutive fractions', () => {
    expect(segments([1, 1, 2])).toEqual([
      { start: 0, size: 0.25 },
      { start: 0.25, size: 0.25 },
      { start: 0.5, size: 0.5 },
    ]);
  });

  it('gives empty segments for a zero total', () => {
    expect(segments([0, 0])).toEqual([
      { start: 0, size: 0 },
      { start: 0, size: 0 },
    ]);
  });
});
