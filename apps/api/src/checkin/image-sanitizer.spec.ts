import sharp from 'sharp';
import { ImageRejectedError, MAX_EDGE, MAX_UPLOAD_BYTES, sanitizeImage } from './image-sanitizer';

const page = (w = 1200, h = 800) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 230, g: 230, b: 230 } } });

/** A JPEG that carries GPS-like EXIF and an orientation flag. */
async function jpegWithExif(orientation = 6) {
  return page().withExif({ IFD0: { Copyright: 'SECRET-OWNER', ImageDescription: 'GPS 31.63,-8.00' } }).withMetadata({ orientation }).jpeg().toBuffer();
}

const rejects = async (buf: Buffer, code: string) => {
  await expect(sanitizeImage(buf)).rejects.toBeInstanceOf(ImageRejectedError);
  await expect(sanitizeImage(buf)).rejects.toMatchObject({ code });
};

describe('sanitizeImage', () => {
  it('re-encodes a JPEG and strips all metadata (EXIF, GPS, description)', async () => {
    const input = await jpegWithExif();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really has EXIF
    expect(input.includes(Buffer.from('SECRET-OWNER'))).toBe(true);

    const { jpeg } = await sanitizeImage(input);
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(jpeg.includes(Buffer.from('SECRET-OWNER'))).toBe(false);
    expect(jpeg.includes(Buffer.from('GPS'))).toBe(false);
  });

  it('applies the EXIF orientation before dropping it', async () => {
    const { width, height, jpeg } = await sanitizeImage(await jpegWithExif(6)); // 1200x800 stored, rotated 90 degrees
    expect([width, height]).toEqual([800, 1200]);
    expect((await sharp(jpeg).metadata()).orientation).toBeUndefined();
  });

  it('accepts PNG and WebP and always returns JPEG', async () => {
    for (const buf of [await page().png().toBuffer(), await page().webp().toBuffer()]) {
      expect((await sharp((await sanitizeImage(buf)).jpeg).metadata()).format).toBe('jpeg');
    }
  });

  it('flattens transparency onto white instead of black', async () => {
    const png = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp((await sanitizeImage(png)).jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });

  it('caps the longest edge at 2000 px and never enlarges', async () => {
    const big = await sanitizeImage(await page(4000, 3000).jpeg().toBuffer());
    expect(Math.max(big.width, big.height)).toBe(MAX_EDGE);
    const small = await sanitizeImage(await page(900, 600).jpeg().toBuffer());
    expect([small.width, small.height]).toEqual([900, 600]);
  });

  it('refuses content that is not an allowed image, whatever it claims to be', async () => {
    await rejects(Buffer.from('%PDF-1.7 hello'), 'IMAGE_INVALID');
    await rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'IMAGE_INVALID');
    await rejects(Buffer.from('GIF89a......'), 'IMAGE_INVALID');
    await rejects(Buffer.from('MZ\x90\x00 executable'), 'IMAGE_INVALID');
    await rejects(Buffer.alloc(0), 'IMAGE_INVALID');
  });

  it('refuses an image header followed by junk, and truncated images', async () => {
    await rejects(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<script>alert(1)</script>'.repeat(50))]), 'IMAGE_INVALID');
    const good = await page().jpeg().toBuffer();
    await rejects(good.subarray(0, Math.floor(good.length / 3)), 'IMAGE_INVALID');
  });

  it('drops a payload appended after a valid image (polyglot)', async () => {
    const good = await page().jpeg().toBuffer();
    const polyglot = Buffer.concat([good, Buffer.from('<?php system($_GET["c"]); ?>'), Buffer.from('PK\x03\x04zipdata')]);
    const { jpeg } = await sanitizeImage(polyglot);
    expect(jpeg.includes(Buffer.from('<?php'))).toBe(false);
    expect(jpeg.includes(Buffer.from('PK\x03\x04'))).toBe(false);
  });

  it('refuses uploads over 8 MB and images over the pixel limit before decoding them', async () => {
    await rejects(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_UPLOAD_BYTES)]), 'IMAGE_TOO_LARGE');
    // 12,000 x 12,000 (144 million pixels) of one colour: a few KB as PNG, gigabytes if decoded naively.
    const bomb = await sharp({ create: { width: 12_000, height: 12_000, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(2_000_000);
    await rejects(bomb, 'IMAGE_TOO_LARGE');
  });

  it('asks for a retake when the photo is too small to read', async () => {
    await rejects(await page(300, 200).jpeg().toBuffer(), 'IMAGE_TOO_SMALL');
  });
});
