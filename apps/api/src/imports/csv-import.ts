import { parse } from 'csv-parse/sync';
import type { BookingSource } from '@prisma/client';

/** Fields of the Dari import template. Amount fields are MAD with 2 decimals. */
export const IMPORT_FIELDS = [
  'check_in',
  'check_out',
  'platform',
  'confirmation_code',
  'party_size',
  'nightly_revenue',
  'cleaning_fee',
  'addon_revenue',
  'discounts',
  'refunds',
  'platform_commission',
  'taxe_sejour_amount',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ['check_in', 'check_out'];
const AMOUNT_FIELDS: ImportField[] = ['nightly_revenue', 'cleaning_fee', 'addon_revenue', 'discounts', 'refunds', 'platform_commission', 'taxe_sejour_amount'];

/** Header → field, e.g. { "Arrivée": "check_in" }. Unmapped headers are ignored. */
export type Mapping = Partial<Record<string, ImportField>>;

export interface ImportRow {
  line: number;
  checkIn: string;
  checkOut: string;
  platform: BookingSource;
  confirmationCode: string | null;
  partySize: number | null;
  amounts: Partial<Record<(typeof AMOUNT_FIELDS)[number], string>>;
}

export type ImportErrorCode = 'required' | 'invalid_date' | 'checkout_not_after_checkin' | 'too_long' | 'invalid_amount' | 'invalid_platform' | 'invalid_party_size' | 'duplicate_in_file';

export interface ImportError {
  line: number;
  field: ImportField | null;
  code: ImportErrorCode;
}

export interface ParsedImport {
  headers: string[];
  delimiter: string;
  suggestedMapping: Mapping;
  rows: ImportRow[];
  errors: ImportError[];
  totalRows: number;
}

/** Header synonyms (French and English, accent- and case-insensitive) for automatic mapping. */
const SYNONYMS: Record<ImportField, string[]> = {
  check_in: ['check_in', 'checkin', 'check-in', 'arrivee', 'date d arrivee', 'date arrivee', 'arrival', 'start', 'debut', 'from'],
  check_out: ['check_out', 'checkout', 'check-out', 'depart', 'date de depart', 'date depart', 'departure', 'end', 'fin', 'to'],
  platform: ['platform', 'plateforme', 'source', 'canal', 'channel', 'site'],
  confirmation_code: ['confirmation_code', 'confirmation', 'code', 'reference', 'ref', 'booking id', 'reservation id', 'numero de reservation', 'id'],
  party_size: ['party_size', 'guests', 'voyageurs', 'personnes', 'nombre de voyageurs', 'pax', 'adults'],
  nightly_revenue: ['nightly_revenue', 'revenu', 'revenue', 'nuitees', 'hebergement', 'accommodation', 'prix', 'price', 'montant', 'amount', 'total'],
  cleaning_fee: ['cleaning_fee', 'menage', 'frais de menage', 'cleaning', 'cleaning fee'],
  addon_revenue: ['addon_revenue', 'extras', 'services', 'add-ons', 'addons', 'options'],
  discounts: ['discounts', 'discount', 'remise', 'remises', 'reduction', 'reductions', 'promo'],
  refunds: ['refunds', 'refund', 'remboursement', 'remboursements'],
  platform_commission: ['platform_commission', 'commission', 'frais plateforme', 'frais de service', 'service fee', 'host fee'],
  taxe_sejour_amount: ['taxe_sejour_amount', 'taxe de sejour', 'taxe sejour', 'tourist tax', 'city tax', 'occupancy tax'],
};

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<ImportField>();
  for (const header of headers) {
    const h = fold(header);
    for (const field of IMPORT_FIELDS) {
      if (taken.has(field)) continue;
      if (SYNONYMS[field].some((syn) => h === syn)) {
        mapping[header] = field;
        taken.add(field);
        break;
      }
    }
  }
  return mapping;
}

export function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and YYYY/MM/DD; returns YYYY-MM-DD or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else return null;
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "1 234,50 MAD" → "1234.50"; null when empty; undefined when invalid. Negative amounts are refused. */
export function parseAmount(raw: string): string | null | undefined {
  const s = raw.replace(/\s| | |mad|dh|dhs|€|\$/gi, '').trim();
  if (s === '') return null;
  const normalised = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return undefined;
  const value = Number(normalised);
  if (value > 10_000_000) return undefined;
  return value.toFixed(2);
}

const PLATFORMS: Record<string, BookingSource> = { airbnb: 'AIRBNB', booking: 'BOOKING', 'booking.com': 'BOOKING', bookingcom: 'BOOKING', direct: 'DIRECT', directe: 'DIRECT', 'en direct': 'DIRECT', other: 'OTHER', autre: 'OTHER' };

export function parsePlatform(raw: string): BookingSource | undefined {
  const s = fold(raw);
  if (s === '') return 'DIRECT';
  return PLATFORMS[s] ?? (s.includes('airbnb') ? 'AIRBNB' : s.includes('booking') ? 'BOOKING' : undefined);
}

const nights = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** Parses the CSV text with the given mapping (or a suggested one). Never throws on bad rows: they are reported. */
export function parseImport(text: string, mapping?: Mapping, maxRows = 5000): ParsedImport {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  let records: Record<string, string>[];
  let headers: string[];
  try {
    records = parse(body, { columns: true, delimiter, skip_empty_lines: true, trim: true, relax_column_count: true, relax_quotes: true, bom: true }) as Record<string, string>[];
    headers = ((parse(firstLine, { delimiter, trim: true, relax_quotes: true }) as string[][])[0] ?? []).map(String);
  } catch {
    return { headers: [], delimiter, suggestedMapping: {}, rows: [], errors: [{ line: 1, field: null, code: 'required' }], totalRows: 0 };
  }
  if (headers.length === 0) return { headers, delimiter, suggestedMapping: {}, rows: [], errors: [{ line: 1, field: null, code: 'required' }], totalRows: 0 };
  const suggestedMapping = suggestMapping(headers);
  const map = mapping ?? suggestedMapping;
  const columnFor = (field: ImportField) => Object.entries(map).find(([, f]) => f === field)?.[0];

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seen = new Set<string>();
  records.slice(0, maxRows).forEach((record, i) => {
    const line = i + 2; // 1-based, after the header
    const get = (field: ImportField) => {
      const col = columnFor(field);
      return col === undefined ? '' : (record[col] ?? '').trim();
    };
    const rowErrors: ImportError[] = [];
    for (const f of REQUIRED_FIELDS) if (get(f) === '') rowErrors.push({ line, field: f, code: 'required' });
    const checkIn = parseDate(get('check_in'));
    const checkOut = parseDate(get('check_out'));
    if (get('check_in') && !checkIn) rowErrors.push({ line, field: 'check_in', code: 'invalid_date' });
    if (get('check_out') && !checkOut) rowErrors.push({ line, field: 'check_out', code: 'invalid_date' });
    if (checkIn && checkOut) {
      if (nights(checkIn, checkOut) < 1) rowErrors.push({ line, field: 'check_out', code: 'checkout_not_after_checkin' });
      else if (nights(checkIn, checkOut) > 365) rowErrors.push({ line, field: 'check_out', code: 'too_long' });
    }
    const platform = parsePlatform(get('platform'));
    if (!platform) rowErrors.push({ line, field: 'platform', code: 'invalid_platform' });
    const partyRaw = get('party_size');
    const partySize = partyRaw === '' ? null : /^\d{1,2}$/.test(partyRaw) && Number(partyRaw) > 0 ? Number(partyRaw) : undefined;
    if (partySize === undefined) rowErrors.push({ line, field: 'party_size', code: 'invalid_party_size' });
    const amounts: ImportRow['amounts'] = {};
    for (const f of AMOUNT_FIELDS) {
      const v = parseAmount(get(f));
      if (v === undefined) rowErrors.push({ line, field: f, code: 'invalid_amount' });
      else if (v !== null) amounts[f] = v;
    }
    const confirmationCode = get('confirmation_code').slice(0, 64) || null;
    if (rowErrors.length === 0 && checkIn && checkOut && platform) {
      const key = confirmationCode ?? `${checkIn}:${checkOut}:${platform}`;
      if (seen.has(key)) rowErrors.push({ line, field: confirmationCode ? 'confirmation_code' : null, code: 'duplicate_in_file' });
      seen.add(key);
    }
    if (rowErrors.length) errors.push(...rowErrors);
    else rows.push({ line, checkIn: checkIn!, checkOut: checkOut!, platform: platform!, confirmationCode, partySize: partySize ?? null, amounts });
  });

  return { headers, delimiter, suggestedMapping, rows, errors, totalRows: records.length };
}

/** Escapes a value for CSV output, neutralising spreadsheet formula prefixes (=, +, -, @). */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const TEMPLATE_CSV =
  [IMPORT_FIELDS.join(','), ['2026-01-10', '2026-01-14', 'AIRBNB', 'HMABC123', '2', '3200.00', '250.00', '0', '0', '0', '480.00', '0'].join(',')].join('\n') + '\n';
