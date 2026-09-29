/** Photo preparation in the browser: the image the server receives is already upright and no larger than needed. */
export const MAX_EDGE = 2000;
export const MIN_SIDE = 400;

export class ImageProblem extends Error {
  constructor(readonly code: 'IMAGE_INVALID' | 'IMAGE_TOO_SMALL') {
    super(code);
  }
}

/**
 * Decodes a photo (applying its EXIF orientation), scales it so the longest side is at most 2000 px and returns a
 * JPEG. Metadata is dropped by the re-encoding; the server sanitises it again and never trusts this step.
 */
export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageProblem('IMAGE_INVALID'); // a format this browser cannot decode (for example HEIC on desktop)
  }
  try {
    if (Math.min(bitmap.width, bitmap.height) < MIN_SIDE) throw new ImageProblem('IMAGE_TOO_SMALL');
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageProblem('IMAGE_INVALID');
    ctx.fillStyle = '#fff'; // flatten transparency onto white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new ImageProblem('IMAGE_INVALID');
    return blob;
  } finally {
    bitmap.close();
  }
}
