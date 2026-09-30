import sharp from 'sharp';
import { DocumentRejectedError, isPdf, MAX_DOCUMENT_BYTES, prepareDocument } from './document-type';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

describe('prepareDocument', () => {
  it('stores a PDF as it is, recognised by content', async () => {
    expect(isPdf(pdf)).toBe(true);
    expect(await prepareDocument(pdf)).toEqual({ bytes: pdf, kind: 'pdf' });
  });

  it('re-encodes a photo to JPEG and drops its metadata', async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#88aa22' } }).withMetadata({ exif: { IFD0: { Copyright: 'secret-owner' } } }).png().toBuffer();
    const r = await prepareDocument(png);
    expect(r.kind).toBe('image');
    expect(r.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.bytes.includes(Buffer.from('secret-owner'))).toBe(false);
  });

  it.each([
    ['empty', Buffer.alloc(0), 'DOCUMENT_INVALID'],
    ['text', Buffer.from('hello world, not a document'), 'DOCUMENT_INVALID'],
    ['an HTML page', Buffer.from('<html><script>alert(1)</script></html>'), 'DOCUMENT_INVALID'],
    ['too large', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(MAX_DOCUMENT_BYTES)]), 'DOCUMENT_TOO_LARGE'],
  ])('refuses %s', async (_n, input, code) => {
    await expect(prepareDocument(input)).rejects.toMatchObject({ code });
    await expect(prepareDocument(input)).rejects.toBeInstanceOf(DocumentRejectedError);
  });
});
