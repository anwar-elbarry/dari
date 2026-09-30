import { createHmac, timingSafeEqual } from 'node:crypto';

/** Meta signs the raw request body: `X-Hub-Signature-256: sha256=<hex hmac>` with the app secret. Compared in constant time. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sign(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export type ReportedStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export interface StatusReport {
  providerMessageId: string;
  status: ReportedStatus;
}

const MAP: Record<string, ReportedStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Delivery reports only. Anything else in the payload (inbound messages, contacts, numbers, error texts) is
 * ignored on purpose: this app has no two-way conversation and stores none of it.
 */
export function parseStatusReports(payload: unknown, max = 200): StatusReport[] {
  const out: StatusReport[] = [];
  if (!isObject(payload) || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const statuses = isObject(change) && isObject(change.value) ? change.value.statuses : undefined;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        if (!isObject(s) || typeof s.id !== 'string' || s.id.length > 200 || typeof s.status !== 'string') continue;
        const status = MAP[s.status];
        if (status && out.length < max) out.push({ providerMessageId: s.id, status });
      }
    }
  }
  return out;
}
