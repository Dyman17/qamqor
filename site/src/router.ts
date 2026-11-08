export interface RouteCtx { path: string; query: URLSearchParams; params: Record<string, string>; /** false once another navigation has started */ alive: () => boolean; }
type Cleanup = void | (() => void);
export interface View { mount(root: HTMLElement, ctx: RouteCtx): Cleanup | Promise<Cleanup>; }

interface Route { pattern: RegExp; keys: string[]; load: () => Promise<View>; }

function r(path: string, load: () => Promise<View>): Route {
  const keys: string[] = [];
  const src = path.replace(/:([A-Za-z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*$/, '(?:/.*)?');
  return { pattern: new RegExp(`^${src}/?$`), keys, load };
}

const routes: Route[] = [
  r('/', () => import('./landing/landing')),
  r('/login', () => import('./app/auth-views')),
  r('/register', () => import('./app/auth-views')),
  r('/forgot', () => import('./app/auth-views')),
  r('/reset', () => import('./app/auth-views')),
  r('/invite', () => import('./app/auth-views')),
  r('/app*', () => import('./app/app')),
];

let rootEl: HTMLElement;
let cleanup: (() => void) | null = null;
let token = 0;
let leaveGuard: (() => boolean | Promise<boolean>) | null = null;

/** A view that holds unsaved, unrecoverable state (the device secret) installs a guard; return false to stay. */
export function setLeaveGuard(fn: (() => boolean | Promise<boolean>) | null): void { leaveGuard = fn; }

export function currentPath(): string { return location.pathname; }

export async function navigate(to: string, opts: { replace?: boolean } = {}): Promise<void> {
  if (leaveGuard) {
    const ok = await leaveGuard();
    if (!ok) return;
    leaveGuard = null;
  }
  if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  await render(true);
}

async function render(moved: boolean): Promise<void> {
  const my = ++token;
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  rootEl.replaceChildren();
  rootEl.removeAttribute('class');

  let view: View | null = null;
  const params: Record<string, string> = {};
  for (const rt of routes) {
    const m = rt.pattern.exec(path);
    if (m) { rt.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); view = await rt.load(); break; }
  }
  if (my !== token) return;
  if (!view) view = await import('./notfound');
  if (my !== token) return;
  const c = await view.mount(rootEl, { path, query: url.searchParams, params, alive: () => my === token });
  if (my !== token) { if (typeof c === 'function') c(); return; }
  if (typeof c === 'function') cleanup = c;
  if (moved) {
    if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
    const h = rootEl.querySelector<HTMLElement>('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
}

function isInternal(a: HTMLAnchorElement): boolean {
  if (a.target && a.target !== '_self') return false;
  if (a.hasAttribute('download') || a.origin !== location.origin) return false;
  if (/\.[A-Za-z0-9]{1,5}$/.test(a.pathname)) return false;
  if (a.pathname.startsWith('/api/') || a.pathname === '/health') return false;
  if (a.pathname === location.pathname && a.search === location.search && a.hash) return false; // in-page anchor: native
  return true;
}

export function startRouter(root: HTMLElement): void {
  rootEl = root;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest('a');
    if (!a || !isInternal(a as HTMLAnchorElement)) return;
    e.preventDefault();
    const an = a as HTMLAnchorElement;
    void navigate(an.pathname + an.search + an.hash);
  });
  window.addEventListener('popstate', () => { void render(true); });
  void render(false);
}
