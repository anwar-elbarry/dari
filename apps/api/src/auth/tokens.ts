import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, URL-safe. Sent to the user once; only its hash is stored. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 is enough here: tokens are high-entropy random values, not passwords. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
