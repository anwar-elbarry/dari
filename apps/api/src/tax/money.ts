/**
 * Money is integer centimes in every function (rule 9 in CLAUDE.md). The database holds Decimal(12,2); these helpers
 * convert without ever passing through a float. Rounding is half away from zero ("half-up"), per line.
 */

/** Anything with a decimal string form: Prisma's Decimal, a string, or a number that is already an integer of centimes is NOT accepted. */
export interface DecimalLike {
  toFixed(dp: number): string;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** '1234.5' -> 123450. Refuses anything that is not a decimal with at most two places. */
export function toCentimes(value: DecimalLike | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : value.toFixed(2);
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new Error('not a decimal amount');
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('amount too large');
  return m[1] ? -cents : cents;
}

/** 123450 -> '1234.50' (the form Decimal(12,2) columns accept). */
export function centimesToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('not an integer amount');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** amount * numerator / denominator, half away from zero, exact (BigInt) so large amounts never lose a centime. */
export function mulRatio(amount: number, numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(amount) || !Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) throw new Error('invalid ratio');
  const a = BigInt(Math.abs(amount));
  const q = (a * BigInt(numerator) * 2n + BigInt(denominator)) / (2n * BigInt(denominator));
  const out = Number(q);
  return amount < 0 ? -out : out;
}

/** amount * rate, the rate in basis points (1500 = 15 %). */
export const mulBps = (amount: number, bps: number) => mulRatio(amount, bps, 10_000);

/** Never below zero: a refund larger than the revenue is not a negative tax in this estimate. */
export const nonNegative = (cents: number) => (cents < 0 ? 0 : cents);
