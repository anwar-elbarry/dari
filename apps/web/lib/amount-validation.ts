/**
 * The same rules the API enforces for PATCH /bookings/:id/amounts (apps/api/src/compliance/dto.ts): an amount is
 * text with at most two decimals, never a float, and the party size an integer from 1 to 50. The server validates
 * again and is the authority: keep the two in step. Amounts stay strings from the form to the request.
 */
export const AMOUNT_FIELDS = ['nightlyRevenue', 'cleaningFee', 'addonRevenue', 'discounts', 'refunds', 'platformCommission', 'taxeSejourAmount'] as const;
export type AmountField = (typeof AMOUNT_FIELDS)[number];
export type AmountsForm = Record<AmountField | 'partySize', string>;

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
const SPACES = /\s/g; // \s covers the non-breaking and narrow spaces that French formatting produces

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** '' -> null (clears the figure). '1234,5' -> '1234.5'. Negative numbers, exponents, two separators and more than two decimals are refused. */
export function parseAmount(input: string): Parsed<string | null> {
  const text = input.trim().replace(SPACES, '');
  if (text === '') return { ok: true, value: null };
  if (text.includes(',') && text.includes('.')) return { ok: false };
  const normal = text.replace(',', '.');
  return MONEY.test(normal) ? { ok: true, value: normal } : { ok: false };
}

/** '' -> null. Whole numbers from 1 to 50 only. */
export function parsePartySize(input: string): Parsed<number | null> {
  const text = input.trim();
  if (text === '') return { ok: true, value: null };
  if (!/^\d{1,2}$/.test(text)) return { ok: false };
  const n = Number(text);
  return n >= 1 && n <= 50 ? { ok: true, value: n } : { ok: false };
}

export type AmountsBody = Partial<Record<AmountField, string | null>> & { partySize?: number | null };

/** The request body, or the fields that are not acceptable. Every field is sent: an empty one clears the figure. */
export function buildAmountsBody(form: AmountsForm): { ok: true; body: AmountsBody } | { ok: false; errors: Partial<Record<keyof AmountsForm, 'invalid'>> } {
  const body: AmountsBody = {};
  const errors: Partial<Record<keyof AmountsForm, 'invalid'>> = {};
  for (const field of AMOUNT_FIELDS) {
    const parsed = parseAmount(form[field]);
    if (parsed.ok) body[field] = parsed.value;
    else errors[field] = 'invalid';
  }
  const party = parsePartySize(form.partySize);
  if (party.ok) body.partySize = party.value;
  else errors.partySize = 'invalid';
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, body };
}

/** A stored value ("1234.5", null) as the text of an input. */
export const toInputText = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v));
