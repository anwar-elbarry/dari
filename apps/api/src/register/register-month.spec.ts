import { lastMonths, monthOf, parseMonth } from './register-month';

describe('parseMonth', () => {
  it('gives UTC bounds, the end being the first day of the next month', () => {
    expect(parseMonth('2026-10')).toEqual({ start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') });
    expect(parseMonth('2026-12')!.end).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(parseMonth('2028-02')!.end).toEqual(new Date('2028-03-01T00:00:00Z'));
  });
  it.each(['2026-13', '2026-00', '2026-1', '26-10', '2026/10', '2026-10-01', ' 2026-10', '1999-12', '2100-01', '', '2026-10\n', '../etc'])('refuses %j', (v) => {
    expect(parseMonth(v)).toBeNull();
  });
});

describe('monthOf', () => {
  it('uses the UTC date, so midnight on the 1st belongs to its own month', () => {
    expect(monthOf(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
    expect(monthOf(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09');
  });
});

describe('lastMonths', () => {
  it('lists n months ending with the current one, across a year boundary', () => {
    expect(lastMonths(new Date('2026-02-15T10:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
