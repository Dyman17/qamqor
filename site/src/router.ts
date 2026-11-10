import { esc } from './dom';
import { t } from './i18n';
import { ssGet, ssSet } from './storage';
export interface RouteCtx { path: string; query: URLSearchParams; params: Record<string, string>; /** false once another navigation has started */ alive: () => boolean; }
type Cleanup = void | (() => void);
export interface View {
  mount(root: HTMLElement, ctx: RouteCtx): Cleanup | Promise<Cleanup>;
  /** A view that keeps its own shell between navigations to itself (the app dashboard) tears it down here once the user leaves it. */
  dispose?(): void;
}

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
let prevView: View | null = null;
let lastHref = '';

/** True for a failed dynamic import (stale hashed chunk after a deploy, flaky network). */
export function isChunkError(e: unknown): boolean {
  const m = String((e as Error | undefined)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|error loading dynamically/i.test(m);
}
/** Reload once for a chunk error (a new deploy replaced the hashed files). A timestamp in sessionStorage prevents reload loops. */
export function reloadOnceOnChunkError(e: unknown): boolean {
  if (!isChunkError(e)) return false;
  const KEY = 'qamqor.chunkReload';
  const last = Number(ssGet(KEY) || 0);
  if (Date.now() - last < 30000) return false;
  ssSet(KEY, String(Date.now()));
  location.reload();
  return true;
}

function failPage(title: string, hint: string): string {
  return `
          <div style="min-height:100svh;display:grid;place-items:center;padding:24px;background:#F6FAF4;color:#0B1A12;font-family:system-ui,sans-serif;text-align:center;">
            <div style="max-width:420px;display:grid;gap:16px;">
              <h2 style="font-size:22px;margin:0;font-weight:700;">${esc(title)}</h2>
              <p style="margin:0;color:#46594D;font-size:15px;line-height:1.5;">${esc(hint)}</p>
              <button onclick="location.reload()" style="min-height:48px;padding:0 24px;border-radius:16px;background:#0D4A2B;color:#fff;border:0;font-weight:600;font-size:16px;cursor:pointer;">${esc(t('a.route.reload'))}</button>
            </div>
          </div>`;
}

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

  let view: View | null = null;
  const params: Record<string, string> = {};
  for (const rt of routes) {
    const m = rt.pattern.exec(path);
    if (m) {
      rt.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      try {
        view = await rt.load();
      } catch (e) {
        console.error('Failed to load route module:', e);
        if (my !== token) return;
        if (reloadOnceOnChunkError(e)) return;
        prevView?.dispose?.(); prevView = null;
        rootEl.innerHTML = failPage(t('a.route.loadFail'), t('a.route.loadFailHint'));
        return;
      }
      break;
    }
  }
  if (my !== token) return;
  if (!view) {
    try {
      view = await import('./notfound');
    } catch {
      return;
    }
  }
  if (my !== token) return;
  // staying inside a view that owns a persistent shell (the app): it swaps its own content, so keep the DOM
  if (!(prevView && prevView === view && view.dispose)) {
    prevView?.dispose?.();
    rootEl.replaceChildren();
    rootEl.removeAttribute('class');
  }
  prevView = view;
  lastHref = location.pathname + location.search + location.hash;
  try {
    const c = await view.mount(rootEl, { path, query: url.searchParams, params, alive: () => my === token });
    if (my !== token) { if (typeof c === 'function') c(); return; }
    if (typeof c === 'function') cleanup = c;
  } catch (e) {
    console.error('Failed to mount view:', e);
    if (my !== token) return;
    prevView?.dispose?.(); prevView = null;
    rootEl.innerHTML = failPage(t('a.route.renderFail'), t('a.route.renderFailHint'));
    return;
  }
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
  // Back/forward must respect the leave guard too (the one-time device secret screen): the URL has already changed,
  // so a refused leave puts the previous URL back.
  window.addEventListener('popstate', () => {
    void (async () => {
      if (leaveGuard) {
        const ok = await leaveGuard();
        if (!ok) { history.pushState(null, '', lastHref || '/'); return; }
        leaveGuard = null;
      }
      await render(true);
    })();
  });
  void render(false);
}
