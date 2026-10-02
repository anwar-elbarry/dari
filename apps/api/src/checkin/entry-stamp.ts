/**
 * Who does not need an entry stamp number. This is a legal decision for counsel and the prefecture, so it lives in
 * RuleConfig (`checkin.entry_stamp_exemption`) and applies only once validated (`RulesService.entryStampExemption()`).
 * With no enforceable rule, every guest gives the number (rule 5 in CLAUDE.md). The guest form mirrors this
 * function in `apps/web/lib/guest-validation.ts`: keep the two in step.
 */
export interface EntryStampExemption {
  /** ISO 3166 alpha-3 nationalities that need no entry stamp. */
  nationalities: string[];
  /** A guest who answers yes to "Do you also have Moroccan nationality?" needs none either. */
  ifDeclaredMoroccan: boolean;
}

export interface StampSubject {
  nationality: string | null;
  declaredMoroccanNationality: boolean | null;
}

/** Pure: true unless an enforceable exemption covers this guest. */
export function entryStampRequired(exemption: EntryStampExemption | null, g: StampSubject): boolean {
  if (!exemption) return true;
  if (g.nationality && exemption.nationalities.includes(g.nationality)) return false;
  return !(exemption.ifDeclaredMoroccan && g.declaredMoroccanNationality === true);
}

const ALPHA3 = /^[A-Z]{3}$/;

/** Reads a RuleConfig value; anything malformed is dropped, and an exemption that covers nobody is null. */
export function parseEntryStampExemption(value: unknown): EntryStampExemption | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as { nationalities?: unknown; ifDeclaredMoroccan?: unknown };
  const nationalities = Array.isArray(v.nationalities) ? [...new Set(v.nationalities.filter((n): n is string => typeof n === 'string' && ALPHA3.test(n)))].slice(0, 50) : [];
  const ifDeclaredMoroccan = v.ifDeclaredMoroccan === true;
  return nationalities.length > 0 || ifDeclaredMoroccan ? { nationalities, ifDeclaredMoroccan } : null;
}
