/** localStorage / sessionStorage can throw (private windows, blocked site data). The site must work without them. */
export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
export function lsDel(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
export function ssGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function ssSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}
export function ssDel(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}
