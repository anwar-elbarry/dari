/**
 * The same rules the API enforces (apps/api/src/checkin/dto.ts), so the guest sees a mistake before sending.
 * The server validates everything again and is the authority: keep the two in step.
 */
export type GuestForm = {
  docType: 'PASSPORT' | 'CIN';
  fullName: string;
  nationality: string;
  docNumber: string;
  dob: string;
  docExpiryDate: string;
  declaredMoroccanNationality: '' | 'yes' | 'no';
  entryStampNumber: string;
  cityOfOrigin: string;
  nextDestination: string;
  profession: string;
};

/** Mirrors `entryStampRequired()` in apps/api/src/checkin/entry-stamp.ts. The rule itself comes from the API (RuleConfig). */
export interface EntryStampExemption {
  nationalities: string[];
  ifDeclaredMoroccan: boolean;
}

export function entryStampRequired(exemption: EntryStampExemption | null, f: Pick<GuestForm, 'nationality' | 'declaredMoroccanNationality'>): boolean {
  if (!exemption) return true;
  if (f.nationality && exemption.nationalities.includes(f.nationality)) return false;
  return !(exemption.ifDeclaredMoroccan && f.declaredMoroccanNationality === 'yes');
}

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u;
const FREE_TEXT = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]+$/u;
const STAMP = /^[A-Za-z0-9][A-Za-z0-9 /.-]*$/;
const DOC_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{2,18}[A-Za-z0-9]$/;

export const clean = (v: string) => v.normalize('NFC').replace(/\s+/g, ' ').trim();

function realDate(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

/** Field name → error key (translated by the caller). Empty object when the form is acceptable. */
export function validate(f: GuestForm, now = new Date(), exemption: EntryStampExemption | null = null): Partial<Record<keyof GuestForm, 'required' | 'invalid'>> {
  const e: Partial<Record<keyof GuestForm, 'required' | 'invalid'>> = {};
  const name = clean(f.fullName);
  if (!name) e.fullName = 'required';
  else if (name.length < 2 || name.length > 120 || !NAME.test(name)) e.fullName = 'invalid';
  if (!f.nationality) e.nationality = 'required';
  const number = clean(f.docNumber);
  if (!number) e.docNumber = 'required';
  else if (!DOC_NUMBER.test(number)) e.docNumber = 'invalid';
  const dob = realDate(f.dob);
  if (!f.dob) e.dob = 'required';
  else if (!dob || dob > now || dob.getUTCFullYear() < 1900) e.dob = 'invalid';
  if (f.docExpiryDate) {
    const x = realDate(f.docExpiryDate);
    if (!x || x.getUTCFullYear() < 1990 || x.getUTCFullYear() > now.getUTCFullYear() + 30) e.docExpiryDate = 'invalid';
  }
  if (!f.declaredMoroccanNationality) e.declaredMoroccanNationality = 'required';
  const stamp = clean(f.entryStampNumber);
  if (!entryStampRequired(exemption, f)) {
    /* not asked: the field is hidden and not sent */
  } else if (!stamp) e.entryStampNumber = 'required';
  else if (stamp.length > 40 || !STAMP.test(stamp)) e.entryStampNumber = 'invalid';
  for (const key of ['cityOfOrigin', 'nextDestination', 'profession'] as const) {
    const v = clean(f[key]);
    if (!v) e[key] = 'required';
    else if (v.length < 2 || v.length > 80 || !FREE_TEXT.test(v)) e[key] = 'invalid';
  }
  return e;
}
