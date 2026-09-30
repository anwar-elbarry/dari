import { createHash } from 'node:crypto';

/** The fields a police register needs for every guest. A submitted guest missing one is reported. */
export const MANDATORY_FIELDS = ['docNumber', 'entryStampNumber', 'cityOfOrigin', 'nextDestination', 'profession'] as const;
export type MandatoryField = (typeof MANDATORY_FIELDS)[number];

export interface RegisterGuest {
  id: string;
  status: 'PENDING' | 'SUBMITTED' | 'VERIFIED';
  guestIndex: number | null;
  docType: 'PASSPORT' | 'CIN' | null;
  fullName: string | null;
  nationality: string | null;
  docNumber: string | null;
  dob: Date | null;
  entryStampNumber: string | null;
  cityOfOrigin: string | null;
  nextDestination: string | null;
  profession: string | null;
}
export interface RegisterStay {
  id: string;
  checkIn: Date;
  checkOut: Date;
  partySize: number | null;
  guests: RegisterGuest[];
}
export interface RegisterProperty {
  name: string;
  address: string;
  commune: string;
}

export const PROBLEM_KINDS = ['NO_CHECKIN', 'PARTY_INCOMPLETE', 'DRAFT', 'MISSING_FIELD', 'UNVERIFIED'] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** Identifiers and field names only, never a name or a document number. */
export interface Problem {
  kind: ProblemKind;
  bookingId: string;
  guestId?: string;
  fields?: MandatoryField[];
}

export interface Summary {
  stays: number;
  guests: number;
  problems: number;
  byKind: Record<ProblemKind, number>;
}

export interface RegisterRow {
  n: number;
  bookingId: string;
  checkIn: Date;
  checkOut: Date;
  /** The stay goes on after the month: it appears here only, under the month of arrival. */
  continuesNextMonth: boolean;
  guest: RegisterGuest;
}

const blank = (v: string | null) => v === null || v.trim() === '';
const submitted = (g: RegisterGuest) => g.status === 'SUBMITTED' || g.status === 'VERIFIED';

/** Pure: the rows of the register, the incomplete records, and the digest of what they were built from. `monthEnd` is the first day of the next month. */
export function buildRegister(stays: RegisterStay[], property: RegisterProperty, monthEnd: Date) {
  const ordered = [...stays].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime() || a.id.localeCompare(b.id));
  const rows: RegisterRow[] = [];
  const problems: Problem[] = [];

  for (const stay of ordered) {
    const guests = [...stay.guests].sort((a, b) => (a.guestIndex ?? 1e9) - (b.guestIndex ?? 1e9) || a.id.localeCompare(b.id));
    const done = guests.filter(submitted);
    if (guests.length === 0) problems.push({ kind: 'NO_CHECKIN', bookingId: stay.id });
    else if (stay.partySize !== null && done.length > 0 && done.length < stay.partySize) problems.push({ kind: 'PARTY_INCOMPLETE', bookingId: stay.id });
    for (const g of guests) {
      if (g.status === 'PENDING') {
        problems.push({ kind: 'DRAFT', bookingId: stay.id, guestId: g.id });
        continue;
      }
      const missing = MANDATORY_FIELDS.filter((f) => blank(g[f]));
      if (missing.length > 0) problems.push({ kind: 'MISSING_FIELD', bookingId: stay.id, guestId: g.id, fields: missing });
      if (g.status === 'SUBMITTED') problems.push({ kind: 'UNVERIFIED', bookingId: stay.id, guestId: g.id });
      rows.push({ n: rows.length + 1, bookingId: stay.id, checkIn: stay.checkIn, checkOut: stay.checkOut, continuesNextMonth: stay.checkOut.getTime() > monthEnd.getTime(), guest: g });
    }
  }

  const byKind = Object.fromEntries(PROBLEM_KINDS.map((k) => [k, problems.filter((p) => p.kind === k).length])) as Record<ProblemKind, number>;
  const summary: Summary = { stays: ordered.length, guests: rows.length, problems: problems.length, byKind };
  return { rows, problems, summary, digest: digestOf(ordered, property) };
}

/** Changes whenever anything printed on the register, or its list of problems, changes. Hashed: it is stored, and the values are not. */
export function digestOf(ordered: RegisterStay[], property: RegisterProperty): string {
  const view = ordered.map((s) => ({
    id: s.id,
    in: s.checkIn.toISOString(),
    out: s.checkOut.toISOString(),
    party: s.partySize,
    guests: [...s.guests]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((g) => (g.status === 'PENDING' ? { id: g.id, status: g.status } : { ...g, dob: g.dob?.toISOString() ?? null })),
  }));
  return createHash('sha256').update(JSON.stringify([property.name, property.address, property.commune, view])).digest('hex');
}
