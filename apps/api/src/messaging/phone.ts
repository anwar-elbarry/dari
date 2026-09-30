/**
 * Phone numbers are personal data: they are normalised here, sent to the provider and never logged or stored
 * beyond the manager's own number. E.164 only ("+" and 8 to 15 digits), the form WhatsApp expects.
 */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Accepts "+212 6 12-34.56.78", "00212612345678" and returns "+212612345678", or null. A national "06..." number is refused: the country is not guessed. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  // "+33 (0)1..." keeps the national trunk digit in brackets: joined as it is, the number would be wrong. Ask for the plain form.
  if (/\(\s*0\s*\)/.test(input)) return null;
  let s = input.trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return E164.test(s) ? s : null;
}

/** For screens: keeps the country prefix and the last two digits only. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}${'•'.repeat(Math.max(phone.length - 6, 2))}${phone.slice(-2)}`;
}

/** WhatsApp templates take plain single-line text: no line breaks, tabs or runs of spaces (Meta rejects them). */
export function templateVariable(value: string, max = 200): string {
  const v = value.replace(/\s+/g, ' ').trim();
  return (v.length > max ? v.slice(0, max) : v) || '-';
}
