import { ImageRejectedError, sanitizeImage } from '../checkin/image-sanitizer';

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export type DocumentRejection = 'DOCUMENT_INVALID' | 'DOCUMENT_TOO_LARGE';

export class DocumentRejectedError extends Error {
  constructor(readonly code: DocumentRejection) {
    super(code);
  }
}

/** By content, never by the client's Content-Type or file name. */
export function isPdf(b: Buffer): boolean {
  return b.length > 8 && b.toString('latin1', 0, 5) === '%PDF-';
}

/**
 * A licence document is a PDF or a photo/scan. A photo is decoded and re-encoded (metadata dropped, as for ID
 * scans); a PDF is stored as it is but is never rendered by the app: it is served as a download with `nosniff`,
 * so its active content never runs in our origin. Returns the bytes to store.
 */
export async function prepareDocument(input: Buffer): Promise<{ bytes: Buffer; kind: 'pdf' | 'image' }> {
  if (input.length === 0) throw new DocumentRejectedError('DOCUMENT_INVALID');
  if (input.length > MAX_DOCUMENT_BYTES) throw new DocumentRejectedError('DOCUMENT_TOO_LARGE');
  if (isPdf(input)) return { bytes: input, kind: 'pdf' };
  try {
    return { bytes: (await sanitizeImage(input)).jpeg, kind: 'image' };
  } catch (e) {
    if (e instanceof ImageRejectedError) throw new DocumentRejectedError(e.code === 'IMAGE_TOO_LARGE' ? 'DOCUMENT_TOO_LARGE' : 'DOCUMENT_INVALID');
    throw new DocumentRejectedError('DOCUMENT_INVALID');
  }
}
