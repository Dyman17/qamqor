/**
 * Safety guard: tests may only touch a disposable local database.
 * Throws unless the URL points to localhost and the database name ends with `_test`.
 */
export function assertTestDatabaseUrl(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL_TEST is not a valid URL');
  }
  const host = parsed.hostname;
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error(`Refusing to run tests: host "${host}" is not local`);
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!dbName.endsWith('_test')) {
    throw new Error('Refusing to run tests: database name must end with "_test"');
  }
}
