import { countNights, dayLevel, projectedBreachDate } from './day-counter';

describe('countNights', () => {
  it('excludes the checkout night', () => {
    expect(countNights([{ checkIn: '2026-03-01', checkOut: '2026-03-04' }], 2026)).toBe(3);
  });

  it('counts overlapping bookings once', () => {
    const b = [
      { checkIn: '2026-03-01', checkOut: '2026-03-05' },
      { checkIn: '2026-03-03', checkOut: '2026-03-08' },
    ];
    expect(countNights(b, 2026)).toBe(7);
  });

  it('clips bookings to the calendar year', () => {
    const b = [{ checkIn: '2025-12-30', checkOut: '2026-01-03' }];
    expect(countNights(b, 2026)).toBe(2);
    expect(countNights(b, 2025)).toBe(2);
  });
});

describe('dayLevel', () => {
  it.each([
    [89, 'green'],
    [90, 'amber'],
    [110, 'amber'],
    [111, 'red'],
  ])('%i nights -> %s', (n, level) => {
    expect(dayLevel(n)).toBe(level);
  });
});

describe('projectedBreachDate', () => {
  it('returns the date of the cap-th night, ignoring overlaps and other years', () => {
    const b = [
      { checkIn: '2026-01-01', checkOut: '2026-01-03' }, // nights 1-2
      { checkIn: '2026-01-02', checkOut: '2026-01-05' }, // nights 2-4 (2 overlaps)
      { checkIn: '2025-12-30', checkOut: '2026-01-01' }, // previous year only
    ];
    expect(projectedBreachDate(b, 2026, 3)).toBe('2026-01-03');
    expect(projectedBreachDate(b, 2026, 4)).toBe('2026-01-04');
    expect(projectedBreachDate(b, 2026, 5)).toBeNull();
  });
});
