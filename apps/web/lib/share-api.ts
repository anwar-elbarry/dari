import { ApiError } from './api';

/**
 * Client for the public Secure Share route. There is no session and no cookie: the link's token travels in the
 * `X-Share-Token` header, never in a URL. Every unusable link (unknown, expired, revoked, file gone) gives the
 * same 404, which is all this page ever learns about why.
 */
export async function fetchSharedPdf(token: string): Promise<Blob> {
  const res = await fetch('/api/share', {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { 'X-Share-Token': token },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? res.statusText);
  }
  const blob = await res.blob();
  if (blob.type !== 'application/pdf') throw new ApiError(502, 'ERROR', 'Unexpected content');
  return blob;
}
