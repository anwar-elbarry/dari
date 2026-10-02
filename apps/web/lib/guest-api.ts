import { ApiError } from './api';
import type { EntryStampExemption } from './guest-validation';

/**
 * Client for the public guest routes. There is no session: the link's token travels in the `X-Checkin-Token`
 * header (never in a URL), plus the CSRF header the API requires. No refresh logic, no cookies needed.
 */
export async function guestApi<T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api/checkin${path}`, {
    method,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { 'X-Requested-With': 'dari', 'X-Checkin-Token': token, ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? res.statusText, e?.details);
  }
  return (await res.json()) as T;
}

export interface CheckinView {
  property: { name: string };
  stay: { checkIn: string; checkOut: string };
  guests: { submitted: number; max: number; remaining: number };
  consent: { id: string; version: string; locale: string; body: string };
  limits: { maxImageBytes: number; maxUploadsPerGuest: number };
  requiredFields: string[];
  /** Who may leave the entry stamp out; null while counsel has validated no exemption (everyone gives it). */
  entryStampExemption: EntryStampExemption | null;
}

export type OcrStatus = 'ok' | 'partial' | 'no_mrz' | 'unreadable' | 'unavailable';
export type FormField = 'docType' | 'fullName' | 'nationality' | 'docNumber' | 'dob' | 'docExpiryDate';

export interface UploadResult {
  draftId: string;
  uploadsLeft: number;
  ocr: {
    status: OcrStatus;
    reason?: string;
    suggestion: Partial<Record<FormField, string>>;
    flagged: FormField[];
    unverified: FormField[];
    confidence: number;
    quality: { blurry: boolean; lowContrast: boolean } | null;
  };
}

export interface SubmitResult {
  status: 'submitted';
  guestIndex: number;
  remaining: number;
  canAddGuest: boolean;
}
