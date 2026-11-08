import { createHash, randomBytes } from 'crypto';

/** 32 random bytes, URL-safe. Sent to the user once; only the hash is stored. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a token (tokens are high-entropy, so a fast hash is sufficient). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export const normalizeEmail = (email: string): string => email.toLowerCase().trim();
