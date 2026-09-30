import { lastFullMonthBefore } from './retention.service';

describe('lastFullMonthBefore', () => {
  it.each([
    ['2027-01-31T10:00:00Z', '2027-01'], // the cutoff is the last day of January: January has ended
    ['2027-01-30T23:59:00Z', '2026-12'],
    ['2027-02-01T00:00:00Z', '2027-01'],
    ['2028-02-29T12:00:00Z', '2028-02'], // leap year
    ['2027-02-28T12:00:00Z', '2027-02'],
    ['2027-01-01T00:00:00Z', '2026-12'],
  ])('%s → %s', (cutoff, month) => {
    expect(lastFullMonthBefore(new Date(cutoff))).toBe(month);
  });
});
