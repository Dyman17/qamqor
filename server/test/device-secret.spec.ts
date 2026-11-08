import * as crypto from 'crypto';
import { generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret } from '../src/devices/device-secret';

describe('device-secret', () => {
  it('generates 32 random bytes as hex, unique each time', () => {
    const a = generateDeviceSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateDeviceSecret()).not.toBe(a);
  });
  it('hash is deterministic sha256 hex', () => {
    expect(hashDeviceSecret('abc')).toBe(hashDeviceSecret('abc'));
    expect(hashDeviceSecret('abc')).toBe(crypto.createHash('sha256').update('abc').digest('hex'));
  });
  it('verifies correct and rejects wrong/empty secrets', () => {
    const s = generateDeviceSecret();
    const h = hashDeviceSecret(s);
    expect(verifyDeviceSecret(s, h)).toBe(true);
    expect(verifyDeviceSecret(generateDeviceSecret(), h)).toBe(false);
    expect(verifyDeviceSecret(undefined, h)).toBe(false);
    expect(verifyDeviceSecret(s, undefined)).toBe(false);
    expect(verifyDeviceSecret(s, 'zz')).toBe(false);
  });
});
