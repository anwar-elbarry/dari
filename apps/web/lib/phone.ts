/**
 * A phone number for WhatsApp: the country code and 8 to 15 digits. Mirrors the API (`normalizePhone`), which is
 * the one that decides; this only saves a round trip. A number written with a bracketed trunk zero, "+33 (0)1...",
 * is refused rather than guessed, and a national "06..." number is refused because the country is not guessed.
 */
export function normalizePhone(input: string): string | null {
  if (input.length > 40 || /\(\s*0\s*\)/.test(input)) return null;
  let s = input.trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
