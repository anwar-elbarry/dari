import { randomBytes } from 'node:crypto';
import { DecryptionError, KeyringError, Keyring, open, parseKeyring, rewrapKey, seal, wrappedKeyId } from './envelope';

const b64 = () => randomBytes(32).toString('base64');
const ring = (...ids: string[]): Keyring => parseKeyring(ids.map((id) => `${id}:${b64()}`).join(','));
const AAD = 'acc-1/acc-1/id_image/obj-1';
const PLAIN = Buffer.from('SPECIMEN PASSPORT IMAGE BYTES '.repeat(50));

describe('envelope encryption', () => {
  it('round-trips, and what is stored is not the plaintext', () => {
    const keyring = ring('k1');
    const { ciphertext, wrappedKey } = seal(PLAIN, keyring, AAD);

    expect(open(ciphertext, wrappedKey, keyring, AAD).equals(PLAIN)).toBe(true);
    expect(ciphertext.includes(Buffer.from('SPECIMEN'))).toBe(false);
    expect(ciphertext.length).toBeGreaterThan(PLAIN.length); // version + iv + tag
    expect(wrappedKey).toMatch(/^k1:[A-Za-z0-9+/=]+$/);
  });

  it('uses a fresh data key and iv for every object', () => {
    const keyring = ring('k1');
    const a = seal(PLAIN, keyring, AAD);
    const b = seal(PLAIN, keyring, AAD);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedKey).not.toBe(b.wrappedKey);
  });

  it('fails with the wrong master key', () => {
    const { ciphertext, wrappedKey } = seal(PLAIN, ring('k1'), AAD);
    expect(() => open(ciphertext, wrappedKey, ring('k1'), AAD)).toThrow(DecryptionError); // same id, different key material
    expect(() => open(ciphertext, wrappedKey, ring('other'), AAD)).toThrow(DecryptionError); // unknown id
  });

  it('fails when the ciphertext or the wrapped key is altered', () => {
    const keyring = ring('k1');
    const { ciphertext, wrappedKey } = seal(PLAIN, keyring, AAD);

    for (const at of [0, 1, 20, ciphertext.length - 1]) {
      const tampered = Buffer.from(ciphertext);
      tampered[at] ^= 0x01;
      expect(() => open(tampered, wrappedKey, keyring, AAD)).toThrow(DecryptionError);
    }
    expect(() => open(ciphertext.subarray(0, ciphertext.length - 5), wrappedKey, keyring, AAD)).toThrow(DecryptionError);
    const [id, body] = [wrappedKeyId(wrappedKey), wrappedKey.slice(wrappedKey.indexOf(':') + 1)];
    const flipped = Buffer.from(body, 'base64');
    flipped[15] ^= 0x01;
    expect(() => open(ciphertext, `${id}:${flipped.toString('base64')}`, keyring, AAD)).toThrow(DecryptionError);
  });

  it('is bound to the account and object key: a copy under another row or account fails', () => {
    const keyring = ring('k1');
    const { ciphertext, wrappedKey } = seal(PLAIN, keyring, AAD);
    expect(() => open(ciphertext, wrappedKey, keyring, 'acc-2/acc-1/id_image/obj-1')).toThrow(DecryptionError);
    expect(() => open(ciphertext, wrappedKey, keyring, 'acc-1/acc-1/id_image/obj-2')).toThrow(DecryptionError);
  });

  it('cannot be opened once the wrapped key is blanked (crypto-shredding)', () => {
    const keyring = ring('k1');
    const { ciphertext } = seal(PLAIN, keyring, AAD);
    expect(() => open(ciphertext, '', keyring, AAD)).toThrow(DecryptionError);
  });

  it('reports every failure with the same message', () => {
    const keyring = ring('k1');
    const { ciphertext, wrappedKey } = seal(PLAIN, keyring, AAD);
    const messages = new Set<string>();
    for (const attempt of [
      () => open(ciphertext, wrappedKey, keyring, 'x'),
      () => open(ciphertext, '', keyring, AAD),
      () => open(Buffer.alloc(3), wrappedKey, keyring, AAD),
      () => open(Buffer.concat([Buffer.from([9]), ciphertext.subarray(1)]), wrappedKey, keyring, AAD),
    ]) {
      try {
        attempt();
      } catch (e) {
        messages.add((e as Error).message);
      }
    }
    expect([...messages]).toEqual(['Object could not be decrypted']);
  });

  it('rotates: rewrapping moves the data key to the new master key without touching the object', () => {
    const oldRing = ring('k1');
    const { ciphertext, wrappedKey } = seal(PLAIN, oldRing, AAD);

    const newRing: Keyring = { currentId: 'k2', keys: new Map([['k2', randomBytes(32)], ['k1', oldRing.keys.get('k1')!]]) };
    const rewrapped = rewrapKey(wrappedKey, newRing, AAD);
    expect(wrappedKeyId(rewrapped)).toBe('k2');
    expect(open(ciphertext, rewrapped, newRing, AAD).equals(PLAIN)).toBe(true);

    // With the old key retired, the rewrapped object still opens; the old wrap no longer does.
    const retired: Keyring = { currentId: 'k2', keys: new Map([['k2', newRing.keys.get('k2')!]]) };
    expect(open(ciphertext, rewrapped, retired, AAD).equals(PLAIN)).toBe(true);
    expect(() => open(ciphertext, wrappedKey, retired, AAD)).toThrow(DecryptionError);
  });
});

describe('parseKeyring', () => {
  it('reads several keys, newest first', () => {
    const k = parseKeyring(`k2:${b64()}, k1:${b64()}`);
    expect(k.currentId).toBe('k2');
    expect([...k.keys.keys()]).toEqual(['k2', 'k1']);
  });

  it.each([
    ['empty', ''],
    ['no id', b64()],
    ['bad id', `K 1:${b64()}`],
    ['short key', `k1:${randomBytes(16).toString('base64')}`],
    ['not base64', 'k1:' + '!'.repeat(44)],
    ['duplicate id', `k1:${b64()},k1:${b64()}`],
  ])('rejects %s without printing key material', (_label, spec) => {
    let error: unknown;
    try {
      parseKeyring(spec);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(KeyringError);
    const message = (error as Error).message;
    for (const part of spec.split(/[:,]/)) if (part.length > 20) expect(message).not.toContain(part);
  });
});
