/**
 * Local time in a named zone, from Intl (no date library): the messaging rules are written in Africa/Casablanca
 * hours and that zone changes its offset around Ramadan, so an offset must never be hard-coded.
 */
export interface LocalParts {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
  /** Zone offset from UTC, in minutes, at that instant. */
  offsetMinutes: number;
}

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const [year, month, day, hour, minute, second] = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((k) => Number(parts[k]));
  const asUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  return { year: year!, month: month!, day: day!, minuteOfDay: hour! * 60 + minute!, offsetMinutes: Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000) };
}

/** Start (UTC instant) of the calendar day that `at` falls in, in `timeZone`. */
export function startOfLocalDay(at: Date, timeZone: string): Date {
  const p = localParts(at, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - p.offsetMinutes * 60_000);
}

export interface QuietWindow {
  startMinute: number;
  endMinute: number;
  timezone: string;
}

/** The window may cross midnight (22:00 to 07:00). An empty window (start = end) is never quiet. */
export function inQuietHours(at: Date, w: QuietWindow): boolean {
  if (w.startMinute === w.endMinute) return false;
  const m = localParts(at, w.timezone).minuteOfDay;
  return w.startMinute < w.endMinute ? m >= w.startMinute && m < w.endMinute : m >= w.startMinute || m < w.endMinute;
}
