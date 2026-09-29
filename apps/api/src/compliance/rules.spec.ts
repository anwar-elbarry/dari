import { boundedInt } from './rules.service';

describe('boundedInt', () => {
  it('accepts whole numbers in range only', () => {
    expect(boundedInt(30, 1, 365)).toBe(30);
    expect(boundedInt(1, 1, 365)).toBe(1);
    expect(boundedInt(365, 1, 365)).toBe(365);
    for (const bad of [0, 366, -5, 1.5, NaN, Infinity, '30', null, undefined, {}, [30]]) expect(boundedInt(bad, 1, 365)).toBeNull();
  });
});
