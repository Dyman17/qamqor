import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** 32 random bytes, hex. Shown to the owner exactly once. */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 hex digest; the only form in which a device secret is stored. */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented secret against a stored hash. */
export function verifyDeviceSecret(provided: string | undefined, storedHash: string | undefined): boolean {
  if (!provided || !storedHash) return false;
  const a = Buffer.from(hashDeviceSecret(provided), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
