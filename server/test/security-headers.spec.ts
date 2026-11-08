import { securityHeaders } from '../src/config/security-headers';

function run(isProd: boolean) {
  const headers: Record<string, string> = {};
  const res: any = { setHeader: (k: string, v: string) => (headers[k] = v) };
  const next = jest.fn();
  securityHeaders(isProd)({} as any, res, next);
  return { headers, next };
}

describe('securityHeaders', () => {
  it('sets nosniff and calls next', () => {
    const { headers, next } = run(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
  it('adds HSTS in production', () => {
    expect(run(true).headers['Strict-Transport-Security']).toContain('max-age');
  });
});
