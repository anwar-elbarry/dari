import ical from 'node-ical';

/** A stay as dates only (`YYYY-MM-DD`), covering [start, end). */
export interface CalendarEvent {
  uid: string;
  start: string;
  end: string;
  summary: string;
  cancelled: boolean;
}

export interface ParseResult {
  events: CalendarEvent[];
  /** Events skipped: no UID, invalid dates, or recurring (platforms do not use RRULE for stays). */
  skipped: number;
}

export const CALENDAR_TZ = 'Africa/Casablanca';

/** Limits on what one feed may make the server store. A property has a few hundred events a year at most. */
export const MAX_EVENTS = 2000;
export const MAX_UID_LENGTH = 255;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date of an instant in the platform's timezone. Date-only values are taken as given. */
export function toCalendarDate(d: Date, dateOnly: boolean): string {
  return dateOnly ? localDay(d) : dayFmt.format(d);
}

/** node-ical builds a date-only value at local midnight of the machine, so read it back with local getters (toISOString shifts it a day on machines east of UTC). */
function localDay(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseIcs(text: string): ParseResult {
  const data = ical.sync.parseICS(text);
  const events: CalendarEvent[] = [];
  let skipped = 0;
  for (const item of Object.values(data)) {
    if (!item || item.type !== 'VEVENT') continue;
    const ev = item;
    const start = ev.start instanceof Date ? ev.start : null;
    const uid = typeof ev.uid === 'string' ? ev.uid.trim() : '';
    if (!start || !uid || uid.length > MAX_UID_LENGTH || ev.rrule) {
      skipped++;
      continue;
    }
    const startDateOnly = (ev.start as Date & { dateOnly?: boolean }).dateOnly === true;
    const endRaw = ev.end instanceof Date ? ev.end : null;
    const endDateOnly = endRaw ? (endRaw as Date & { dateOnly?: boolean }).dateOnly === true : startDateOnly;
    const startDay = toCalendarDate(start, startDateOnly);
    let endDay = endRaw ? toCalendarDate(endRaw, endDateOnly) : startDay;
    // A stay must cover at least one night: a same-day or inverted range becomes one night.
    if (endDay <= startDay) endDay = addDays(startDay, 1);
    events.push({
      uid,
      start: startDay,
      end: endDay,
      summary: typeof ev.summary === 'string' ? ev.summary.trim().slice(0, 200) : '',
      cancelled: typeof ev.status === 'string' && ev.status.toUpperCase() === 'CANCELLED',
    });
  }
  return { events, skipped };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
