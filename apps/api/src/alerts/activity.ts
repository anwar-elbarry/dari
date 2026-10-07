/**
 * Portfolio activity for the dashboard charts: counted nights per month and per platform in one calendar year.
 * Same night rules as the day counter (`day-counter.ts`): [checkIn, checkOut), nights outside the year ignored,
 * a night booked twice on one property (two platforms) counted once. Such a night goes to the stay that starts
 * first (then the platform name), so the platform figures add up to the monthly ones.
 */
export type Source = 'AIRBNB' | 'BOOKING' | 'DIRECT' | 'OTHER';

export interface ActivityStay {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  source: Source;
}

export interface Activity {
  /** Twelve numbers, January first. */
  nightsByMonth: number[];
  nightsBySource: Record<Source, number>;
}

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

export function activity(stays: ActivityStay[], year: number): Activity {
  const start = toDay(`${year}-01-01`);
  const end = toDay(`${year + 1}-01-01`);
  const nightsByMonth = Array.from({ length: 12 }, () => 0);
  const nightsBySource: Record<Source, number> = { AIRBNB: 0, BOOKING: 0, DIRECT: 0, OTHER: 0 };
  const taken = new Map<string, Set<number>>();

  const ordered = [...stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.source.localeCompare(b.source));
  for (const s of ordered) {
    let nights = taken.get(s.propertyId);
    if (!nights) taken.set(s.propertyId, (nights = new Set()));
    const from = Math.max(toDay(s.checkIn), start);
    const to = Math.min(toDay(s.checkOut), end);
    for (let d = from; d < to; d++) {
      if (nights.has(d)) continue;
      nights.add(d);
      nightsByMonth[new Date(d * DAY_MS).getUTCMonth()]! += 1;
      nightsBySource[s.source] += 1;
    }
  }
  return { nightsByMonth, nightsBySource };
}
