import { assertTestDatabaseUrl } from './setup/assert-test-db';

describe('assertTestDatabaseUrl', () => {
  it('accepts a local *_test database', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@localhost:5432/qamqor_test?schema=public')).not.toThrow();
    expect(() => assertTestDatabaseUrl('postgresql://u:p@127.0.0.1:5432/x_test')).not.toThrow();
  });
  it('rejects remote hosts', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@ep-x.neon.tech/qamqor_test')).toThrow(/not local/);
  });
  it('rejects names without _test suffix', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@localhost:5432/qamqor')).toThrow(/_test/);
  });
  it('rejects missing or invalid URL', () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow();
    expect(() => assertTestDatabaseUrl('nonsense')).toThrow();
  });
});
