/**
 * Log redaction. The rule is "logs carry ids only"; this is the backstop for when something slips through
 * (an exception message quoting a value, a debug line). It removes what has a recognisable shape: emails,
 * phone numbers, MRZ lines, document numbers, long tokens, and values under sensitive keys.
 *
 * Limit: a free-text name has no shape and cannot be found in a string. Names stay out of logs because no
 * code logs request bodies or guest objects, and because the exception filter never logs error messages
 * in production. Do not rely on this file to make an unsafe log line safe.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PATTERNS: [RegExp, string | ((m: string) => string)][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
  // Machine-readable zone lines: 30+ characters of A-Z, 0-9 and filler `<`, with at least one `<`.
  [/(?<![A-Z0-9<])(?=[A-Z0-9<]*<)[A-Z0-9<]{30,}(?![A-Z0-9<])/g, '[mrz]'],
  // Phone numbers: international (+212 6 12 34 56 78) and national Moroccan/French (06 12 34 56 78).
  [/\+\d[\d .()-]{7,}\d/g, '[phone]'],
  [/(?<![\d.])0[5-7](?:[ .-]?\d{2}){4}(?![\d])/g, '[phone]'],
  // Passport and CIN numbers: one or two letters then 5-9 digits (AB123456, BK123456), or 9+ plain digits.
  [/\b[A-Z]{1,2}\d{5,9}\b/g, '[docno]'],
  [/(?<![\d.-])\d{9,}(?![\d])/g, '[number]'],
  // Long opaque strings (tokens, keys, hashes). UUIDs are ids and stay readable.
  [/[A-Za-z0-9_-]{32,}/g, (m) => (UUID.test(m) ? m : '[token]')],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement as string);
  return out;
}

/** Object keys whose value is never printed, whatever it contains. Compared lower-case without `_` or `-`. */
const SENSITIVE_KEYS = new Set([
  'name', 'firstname', 'lastname', 'fullname', 'surname', 'givenname', 'guestname',
  'email', 'phone', 'phonenumber', 'address', 'city', 'cityoforigin', 'nextdestination', 'profession',
  'documentnumber', 'docnumber', 'passportnumber', 'cin', 'cinnumber', 'mrz', 'nationality',
  'birthdate', 'dateofbirth', 'birthplace', 'docexpirydate', 'entrystampnumber',
  'password', 'passwordhash', 'token', 'tokenhash', 'accesstoken', 'refreshtoken', 'secret', 'apikey',
  'authorization', 'cookie', 'setcookie', 'url', 'icalurl', 'iban', 'rib', 'taxid',
]);

const MAX_DEPTH = 6;

/** Structured values (objects passed to the logger) are masked by key, then their strings redacted. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) return redactText(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, '')) ? '[redacted]' : redactValue(v, depth + 1);
  }
  return out;
}
