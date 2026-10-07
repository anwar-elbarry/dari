import { activity, type ActivityStay } from './activity';

const stay = (checkIn: string, checkOut: string, source: ActivityStay['source'] = 'AIRBNB', propertyId = 'p1'): ActivityStay => ({ propertyId, checkIn, checkOut, source });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('activity', () => {
  it('counts nights per month, the checkout night excluded', () => {
    const a = activity([stay('2026-01-30', '2026-02-02')], 2026);
    expect(a.nightsByMonth.slice(0, 3)).toEqual([2, 1, 0]);
    expect(a.nightsBySource.AIRBNB).toBe(3);
  });

  it('ignores nights outside the year', () => {
    const a = activity([stay('2025-12-30', '2026-01-02'), stay('2026-12-31', '2027-01-03')], 2026);
    expect(a.nightsByMonth[0]).toBe(1);
    expect(a.nightsByMonth[11]).toBe(1);
    expect(sum(a.nightsByMonth)).toBe(2);
  });

  it('counts a night booked twice on one property once, for the stay that starts first', () => {
    const a = activity([stay('2026-03-03', '2026-03-06', 'BOOKING'), stay('2026-03-01', '2026-03-04', 'AIRBNB')], 2026);
    expect(a.nightsByMonth[2]).toBe(5);
    expect(a.nightsBySource).toEqual({ AIRBNB: 3, BOOKING: 2, DIRECT: 0, OTHER: 0 });
  });

  it('counts the same night on two properties twice', () => {
    const a = activity([stay('2026-05-01', '2026-05-03', 'DIRECT', 'p1'), stay('2026-05-01', '2026-05-03', 'OTHER', 'p2')], 2026);
    expect(a.nightsByMonth[4]).toBe(4);
    expect(a.nightsBySource).toMatchObject({ DIRECT: 2, OTHER: 2 });
  });

  it('platform figures always add up to the monthly ones', () => {
    const stays = [stay('2026-06-28', '2026-07-05', 'AIRBNB'), stay('2026-07-01', '2026-07-10', 'BOOKING'), stay('2026-07-02', '2026-07-03', 'DIRECT', 'p2')];
    const a = activity(stays, 2026);
    expect(sum(Object.values(a.nightsBySource))).toBe(sum(a.nightsByMonth));
  });

  it('gives twelve zeros without stays', () => {
    expect(activity([], 2026).nightsByMonth).toEqual(Array(12).fill(0));
  });
});
