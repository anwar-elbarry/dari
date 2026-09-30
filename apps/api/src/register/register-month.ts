const MONTH_RE = /^(20\d\d)-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` (2000 to 2099) to its UTC bounds; `end` is the first day of the next month. Null for anything else. Stay dates are UTC dates. */
export function parseMonth(value: string): { start: Date; end: Date } | null {
  const m = MONTH_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

/** The month a stay is listed under: the month of arrival, so a guest appears in exactly one register. */
export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The `n` months up to and including `now`'s, oldest first. */
export function lastMonths(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1))));
}
