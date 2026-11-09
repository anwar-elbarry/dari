import { randomBytes } from 'node:crypto';
import { open, parseMasterKey, rewrap, seal } from './envelope';

const kek = () => randomBytes(32);
const data = Buffer.from('synthetic passport image bytes — not real data');

describe('envelope encryption', () => {
  it('round-trips and does not store the plaintext', () => {
    const k = kek();
    const s = seal(k, 'acc1/obj1', data);
    expect(s.ciphertext.includes(data)).toBe(false);
    expect(s.ciphertext.toString('latin1')).not.toContain('passport');
    expect(open(k, 'acc1/obj1', s.ciphertext, s.wrappedKey).equals(data)).toBe(true);
    expect(s.sha256).toHaveLength(64);
  });

  it('uses a fresh data key and IV each time', () => {
    const k = kek();
    const a = seal(k, 'o', data);
    const b = seal(k, 'o', data);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
  });

  it('fails with the wrong master key', () => {
    const s = seal(kek(), 'o', data);
    expect(() => open(kek(), 'o', s.ciphertext, s.wrappedKey)).toThrow('decryption failed');
  });

  it('fails when ciphertext is moved to another object key', () => {
    const k = kek();
    const s = seal(k, 'acc1/obj1', data);
    expect(() => open(k, 'acc2/obj1', s.ciphertext, s.wrappedKey)).toThrow('decryption failed');
  });

  it('detects tampering', () => {
    const k = kek();
    const s = seal(k, 'o', data);
    const bad = Buffer.from(s.ciphertext);
    bad[bad.length - 1] ^= 1;
    expect(() => open(k, 'o', bad, s.wrappedKey)).toThrow('decryption failed');
    expect(() => open(k, 'o', s.ciphertext.subarray(0, 5), s.wrappedKey)).toThrow();
  });

  it('rotates the master key without re-encrypting the object', () => {
    const oldK = kek();
    const newK = kek();
    const s = seal(oldK, 'o', data);
    const wrapped = rewrap(oldK, newK, 'o', s.wrappedKey);
    expect(open(newK, 'o', s.ciphertext, wrapped).equals(data)).toBe(true);
    expect(() => open(oldK, 'o', s.ciphertext, wrapped)).toThrow();
  });

  it('rejects master keys of the wrong size', () => {
    expect(() => parseMasterKey(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(parseMasterKey(Buffer.alloc(32).toString('base64'))).toHaveLength(32);
  });
});
