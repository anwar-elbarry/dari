/**
 * 120-day counter (Tech Spec 6.4).
 * Counts distinct booked nights in a calendar year for one property.
 * Owner blocks are excluded by the caller (surfaced for review, never counted).
 * Dates are ISO `YYYY-MM-DD`; a booking covers [checkIn, checkOut) — checkout night is not counted.
 * Overlapping bookings (same night on two platforms) are counted once.
 */
export interface DateRange {
  checkIn: string;
  checkOut: string;
}

export type DayLevel = 'green' | 'amber' | 'red';

export interface DayCounterThresholds {
  amber: number;
  red: number;
}

/** Defaults follow the spec (alerts at 90 and 110); callers should pass values from config. */
export const DEFAULT_THRESHOLDS: DayCounterThresholds = { amber: 90, red: 110 };

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

export function countNights(bookings: DateRange[], year: number): number {
  const start = toDay(`${year}-01-01`);
  const end = toDay(`${year + 1}-01-01`);
  const nights = new Set<number>();
  for (const b of bookings) {
    const from = Math.max(toDay(b.checkIn), start);
    const to = Math.min(toDay(b.checkOut), end);
    for (let d = from; d < to; d++) nights.add(d);
  }
  return nights.size;
}

/** green < amber, amber from `amber` to `red` inclusive, red above `red`. */
export function dayLevel(nights: number, t: DayCounterThresholds = DEFAULT_THRESHOLDS): DayLevel {
  if (nights > t.red) return 'red';
  if (nights >= t.amber) return 'amber';
  return 'green';
}

/**
 * Date on which the `cap`-th night of `year` will be used, given confirmed stays sorted by check-in,
 * or null if the cap is never reached with the stays known today. Nights already counted are included.
 */
export function projectedBreachDate(bookings: DateRange[], year: number, cap: number): string | null {
  const start = toDay(`${year}-01-01`);
  const end = toDay(`${year + 1}-01-01`);
  const nights = new Set<number>();
  for (const b of bookings) {
    const from = Math.max(toDay(b.checkIn), start);
    const to = Math.min(toDay(b.checkOut), end);
    for (let d = from; d < to; d++) nights.add(d);
  }
  if (nights.size < cap) return null;
  const sorted = [...nights].sort((a, b) => a - b);
  return new Date(sorted[cap - 1] * DAY_MS).toISOString().slice(0, 10);
}
