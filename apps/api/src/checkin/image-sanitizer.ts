import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_EDGE = 2000;
export const MIN_SIDE = 400;

export type ImageProblem = 'IMAGE_INVALID' | 'IMAGE_TOO_LARGE' | 'IMAGE_TOO_SMALL';

export class ImageRejectedError extends Error {
  constructor(readonly code: ImageProblem) {
    super(code);
  }
}

const startsWith = (b: Buffer, ...bytes: number[]) => bytes.every((v, i) => b[i] === v);

/** By content, not by the client's Content-Type or file name. */
function looksLikeAllowedImage(b: Buffer): boolean {
  const jpeg = startsWith(b, 0xff, 0xd8, 0xff);
  const png = startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const webp = b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

export interface SanitizedImage {
  jpeg: Buffer;
  width: number;
  height: number;
}

/**
 * Turns an untrusted upload into a fresh JPEG: size, magic bytes and pixel count are checked from the header,
 * the pixels are decoded and re-encoded (so a polyglot or trailing payload does not survive), orientation is
 * applied and then ALL metadata is dropped (EXIF, GPS, ICC, XMP), the longest edge is capped at 2000 px and
 * transparency is flattened onto white. Nothing from the original file is kept.
 */
export async function sanitizeImage(input: Buffer): Promise<SanitizedImage> {
  if (input.length === 0 || !looksLikeAllowedImage(input)) throw new ImageRejectedError('IMAGE_INVALID');
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageRejectedError('IMAGE_TOO_LARGE');
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new ImageRejectedError('IMAGE_INVALID');
    if (meta.width * meta.height > MAX_PIXELS) throw new ImageRejectedError('IMAGE_TOO_LARGE');
    if (Math.min(meta.width, meta.height) < MIN_SIDE) throw new ImageRejectedError('IMAGE_TOO_SMALL');

    const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate() // apply EXIF orientation; sharp then writes no metadata unless asked to
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImageRejectedError) throw e;
    const message = e instanceof Error ? e.message : '';
    throw new ImageRejectedError(/pixel limit|too large/i.test(message) ? 'IMAGE_TOO_LARGE' : 'IMAGE_INVALID');
  }
}
