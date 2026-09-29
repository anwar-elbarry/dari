import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/** The form fields the worker can suggest. Everything else the guest types. */
export const SUGGESTABLE = ['docType', 'fullName', 'nationality', 'docNumber', 'dob', 'docExpiryDate'] as const;
export type SuggestableField = (typeof SUGGESTABLE)[number];
export type Suggestion = Partial<Record<SuggestableField, string>>;

export type OcrStatus = 'ok' | 'partial' | 'no_mrz' | 'unreadable' | 'unavailable';

/** What the guest form receives. Suggestions only: the server never treats them as verified (rule 5). */
export interface OcrOutcome {
  status: OcrStatus;
  suggestion: Suggestion;
  /** Fields to look at first: a check digit failed, or the value was repaired. */
  flagged: SuggestableField[];
  /** Fields no check digit covers (names, nationality): always worth a look. */
  unverified: SuggestableField[];
  confidence: number;
  quality: { blurry: boolean; lowContrast: boolean } | null;
  /** Worker reason when the image itself was unusable. */
  reason?: 'format' | 'decode' | 'too_large' | 'too_small';
}

const UNAVAILABLE: OcrOutcome = { status: 'unavailable', suggestion: {}, flagged: [], unverified: [], confidence: 0, quality: null };

const WORKER_TO_FORM: Record<string, SuggestableField> = {
  document_number: 'docNumber',
  birth_date: 'dob',
  expiry_date: 'docExpiryDate',
  surname: 'fullName',
  given_names: 'fullName',
  nationality: 'nationality',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);

/** Reads only the fields it knows, with types and lengths checked: the worker's answer is untrusted input. */
export function mapWorkerResponse(body: unknown): OcrOutcome {
  if (!isRecord(body)) return UNAVAILABLE;
  const status = body.status;
  if (status === 'unreadable') {
    const reason = ['format', 'decode', 'too_large', 'too_small'].includes(body.reason as string) ? (body.reason as OcrOutcome['reason']) : 'decode';
    return { ...UNAVAILABLE, status: 'unreadable', reason };
  }
  const quality = isRecord(body.quality) ? { blurry: body.quality.blurry === true, lowContrast: body.quality.low_contrast === true } : null;
  if (status === 'no_mrz') return { ...UNAVAILABLE, status: 'no_mrz', quality };
  if ((status !== 'ok' && status !== 'partial') || !isRecord(body.fields)) return UNAVAILABLE;

  const f = body.fields;
  const fullName = [str(f.given_names, 80), str(f.surname, 80)].filter(Boolean).join(' ') || undefined;
  const suggestion: Suggestion = {
    docType: f.document_type === 'P' ? 'PASSPORT' : 'CIN', // TD1/TD2 identity cards; the guest can change it
    ...(fullName ? { fullName } : {}),
    ...(str(f.nationality, 3) ? { nationality: str(f.nationality, 3) } : {}),
    ...(str(f.document_number, 20) ? { docNumber: str(f.document_number, 20) } : {}),
    ...(str(f.birth_date, 10) ? { dob: str(f.birth_date, 10) } : {}),
    ...(str(f.expiry_date, 10) ? { docExpiryDate: str(f.expiry_date, 10) } : {}),
  };
  const toForm = (v: unknown): SuggestableField[] =>
    [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map((x) => WORKER_TO_FORM[x]).filter(Boolean))];
  const confidence = typeof body.confidence === 'number' && body.confidence >= 0 && body.confidence <= 1 ? body.confidence : 0;
  // A partial read means at least one check failed or a repair happened: never present it as clean.
  const flagged = new Set([...toForm(body.flagged), ...toForm(body.corrected)]);
  // Given names and surname are one form field: flag it if either is flagged; a value that was not read is flagged too.
  for (const key of SUGGESTABLE) if (suggestion[key] === undefined) flagged.add(key);
  const unverified = new Set([...toForm(body.unverified), 'fullName' as const, 'nationality' as const, 'docType' as const]);
  return { status, suggestion, flagged: [...flagged], unverified: [...unverified], confidence, quality };
}

/** Normalised so trivial differences (case, spacing) do not count as an edit. */
export const normalizeForCompare = (v: string) => v.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();

/** Keyed hash of a suggested value: lets the server tell later which fields the guest changed without storing the values. */
export function suggestionHashes(suggestion: Suggestion, draftId: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(suggestion).map(([k, v]) => [k, createHmac('sha256', draftId).update(`${k}:${normalizeForCompare(v ?? '')}`).digest('hex').slice(0, 32)]),
  );
}

@Injectable()
export class OcrClient {
  private readonly logger = new Logger('Ocr');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Sends the sanitised JPEG to the worker and maps its answer. Never throws: any failure means "unavailable"
   * and the guest types the fields. Logs the failure kind only, never content.
   */
  async extract(jpeg: Buffer): Promise<OcrOutcome> {
    const { OCR_SERVICE_URL: url, OCR_SHARED_SECRET: secret } = this.config;
    if (!url || !secret) return UNAVAILABLE;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/v1/extract`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'x-worker-secret': secret },
        body: new Uint8Array(jpeg),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      if (!res.ok) {
        this.logger.warn(`OCR worker answered HTTP ${res.status}`);
        return UNAVAILABLE;
      }
      return mapWorkerResponse(await res.json());
    } catch (e) {
      this.logger.warn(`OCR worker unreachable (${e instanceof Error ? e.name : 'error'})`);
      return UNAVAILABLE;
    }
  }
}
