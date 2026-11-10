import '../styles/app.css';
import { $, $$, html, raw, setHtml, type Safe } from '../dom';
import { applyI18n, bindLangSwitch, getLang, langSwitcherHtml, onLang, t } from '../i18n';
import { isChunkError, navigate, reloadOnceOnChunkError, type RouteCtx, type View } from '../router';
import { openModal } from '../ui/dialog';
import { icon } from '../ui/icons';
import { absTime, errText, skeleton } from './common';
import { getSim, isDemoMode, modeName, onSim, refreshSim, setSim } from './demo';
import { ApiError, get, getFarmId, getToken, net, onNet, onUnauthenticated, post, setFarmId, setSession, type CollarDto, type FarmDto, type UserDto } from './api';

export interface AppCtx {
  farm: FarmDto;
  user: UserDto;
  isOwner: boolean;
  params: Record<string, string>;
  query: URLSearchParams;
  setTitle(title: string): void;
  setActions(content: Safe | string): void;
  refreshChrome(): void;
}
export interface AppView { mount(el: HTMLElement, ctx: AppCtx): void | (() => void) | Promise<void | (() => void)> }

interface Route { re: RegExp; keys: string[]; nav: string; load: () => Promise<AppView> }
const route = (path: string, nav: string, load: () => Promise<AppView>): Route => {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:([A-Za-z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys, nav, load };
};
const ROUTES: Route[] = [
  route('/app/map', 'map', () => import('./views/map')),
  route('/app/herd', 'herd', () => import('./views/herd')),
  route('/app/herd/:id', 'herd', () => import('./views/animal')),
  route('/app/alerts', 'alerts', () => import('./views/alerts')),
  route('/app/collars', 'collars', () => import('./views/collars')),
  route('/app/collars/connect', 'collars', () => import('./views/connect')),
  route('/app/collars/:deviceId', 'collars', () => import('./views/collar')),
  route('/app/settings', 'settings', () => import('./views/settings')),
];

const NAV = [
  { id: 'map', icon: 'map-trifold', href: '/app/map', key: 'a.nav.map' as const },
  { id: 'herd', icon: 'cow', href: '/app/herd', key: 'a.nav.herd' as const },
  { id: 'alerts', icon: 'bell-ringing', href: '/app/alerts', key: 'a.nav.alerts' as const },
  { id: 'collars', icon: 'tag', href: '/app/collars', key: 'a.nav.collars' as const },
];

// session cache survives in-app navigation (the shell is re-mounted on every route change)
let user: UserDto | null = null;
let farms: FarmDto[] = [];
let cacheToken: string | null = null;

function navHtml(active: string, variant: 'side' | 'rail' | 'bottom'): Safe {
  const items = NAV.map((n) => html`<a class="nav-item" href="${n.href}" data-nav="${n.id}" ${n.id === active ? raw('aria-current="page"') : ''}>${raw(icon(n.icon, 26))}<span class="nav-label">${t(n.key)}</span>${n.id === 'alerts' ? html`<span class="nav-badge" id="alert-badge-${variant}" hidden></span>` : ''}</a>`);
  return html`${items}`;
}

async function loadSession(): Promise<'ok' | 'none' | 'error'> {
  if (cacheToken !== getToken()) { user = null; farms = []; cacheToken = getToken(); }
  try {
    if (!user) {
      const me = await get<{ user: UserDto }>('/auth/me', { farm: false });
      user = me.user;
    }
    if (!farms.length) farms = await get<FarmDto[]>('/farms', { farm: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return 'none';
    throw e;
  }
  return 'ok';
}

function logout(): void {
  user = null; farms = [];
  setSession(null);
  void navigate('/login', { replace: true });
}

function resetSession(): void { user = null; farms = []; }

/**
 * The dashboard shell (sidebar, chrome, banners, timers) is built once and kept while the user moves between
 * /app/* pages: a navigation only swaps the content element (#main). It is rebuilt when the language, the session
 * token or the farm changes, and torn down by dispose() when the router leaves the app.
 */
interface Shell {
  root: HTMLElement;
  main: HTMLElement;
  token: string | null;
  farmId: string;
  lang: string;
  farm: FarmDto;
  user: UserDto;
  isOwner: boolean;
  refreshChrome(): void;
  setActive(nav: string): void;
  teardown(): void;
}
let shell: Shell | null = null;

function disposeShell(): void {
  const s = shell;
  shell = null;
  s?.teardown();
}
/** Called by the router when the user leaves /app (see View.dispose). */
export function dispose(): void { disposeShell(); }

/** Builds the shell into root. Returns null when it showed something else (login redirect, error, first-run screen) or went stale. */
async function buildShell(root: HTMLElement, dead: () => boolean, navCleanups: (() => void)[], active: string): Promise<Shell | null> {
  setHtml(root, html`<div class="boot" role="status" aria-label="${t('a.state.loading')}">${skeleton(3)}</div>`);
  // belongs to the shell once it exists; until then (or when we show a non-shell screen) to the current navigation
  const offUnauth = onUnauthenticated(() => { resetSession(); void navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); });
  const bail = (): null => { navCleanups.push(offUnauth); return null; };

  let st: 'ok' | 'none' | 'error';
  let bootErr: unknown;
  try { st = await loadSession(); } catch (e) { st = 'error'; bootErr = e; }
  if (dead()) return bail();
  if (st === 'none') return bail();
  if (st === 'error') {
    setHtml(root, html`<main id="main" class="boot"><div class="state-block error" role="alert"><h1 class="title-2">${t('a.state.error')}</h1><p>${errText(bootErr)}</p><button class="btn btn-primary" id="boot-retry">${t('a.state.retry')}</button></div></main>`);
    $('#boot-retry', root)!.addEventListener('click', () => void navigate(location.pathname + location.search, { replace: true }));
    return bail();
  }
  const u = user!;

  // no farms: first-run screen (api-contract: POST /farms is allowed for owners; a worker without farms cannot create one)
  if (!farms.length) {
    document.title = `${t('a.first.title')} | Qamqor`;
    setHtml(root, html`<main id="main" class="first-run"><h1 class="display">${t('a.first.title')}</h1>
      <form id="first" class="form" novalidate>
        <div class="field"><label for="f-name">${t('a.first.name')}</label><input class="input" id="f-name" required autocomplete="off"></div>
        <div class="field"><label for="f-tz">${t('a.first.tz')}</label><input class="input" id="f-tz" value="Asia/Aqtau" autocomplete="off"></div>
        <p class="field-error" id="f-err" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${t('a.first.submit')}</button>
      </form>
      <p class="muted">${t('a.first.worker')}</p>
      <p><button type="button" class="btn btn-ghost" id="f-out">${t('a.nav.logout')}</button></p></main>`);
    $('#f-out', root)!.addEventListener('click', logout);
    $<HTMLFormElement>('#first', root)!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $<HTMLInputElement>('#f-name', root)!.value.trim();
      const err = $('#f-err', root)!;
      if (!name) { err.textContent = t('a.err.required'); err.hidden = false; return; }
      try {
        const f = await post<FarmDto>('/farms', { name, timezone: $<HTMLInputElement>('#f-tz', root)!.value.trim() || 'Asia/Aqtau' }, { farm: false });
        farms = [f]; setFarmId(f.id);
        void navigate('/app/map', { replace: true });
      } catch (er) {
        err.textContent = er instanceof ApiError && er.status === 403 ? t('a.first.worker') : errText(er);
        err.hidden = false;
      }
    });
    return bail();
  }

  const farm = farms.find((f) => f.id === getFarmId()) ?? farms[0];
  setFarmId(farm.id);
  const isOwner = farm.myRole === 'OWNER';
  const cleanups: (() => void)[] = [];
  let shellDead = false;
  cleanups.push(() => { shellDead = true; });
  cleanups.push(offUnauth);

  setHtml(root, html`
    <a class="skip-link" href="#main">${t('a.skip')}</a>
    <div class="banners"><div id="banners" role="status"></div><div class="demo-strip" id="demo-strip" role="status" hidden></div></div>
    <div class="shell">
      <aside class="side" aria-label="${t('a.nav.main')}">
        <a class="side-brand" href="/app/map">Qamqor</a>
        ${farms.length > 1 ? html`<label class="sr-only" for="farm-sel">${t('a.nav.farm')}</label><select class="select farm-sel" id="farm-sel">${farms.map((f) => html`<option value="${f.id}" ${f.id === farm.id ? raw('selected') : ''}>${f.name}</option>`)}</select>` : html`<p class="side-farm">${farm.name}</p>`}
        <nav class="nav" aria-label="${t('a.nav.main')}">${navHtml(active, 'side')}</nav>
        <div class="side-bottom">
          <a class="nav-item" href="/app/settings" data-nav="settings" ${active === 'settings' ? raw('aria-current="page"') : ''}>${raw(icon('gear-six', 26))}<span class="nav-label">${t('a.nav.settings')}</span></a>
          ${raw(langSwitcherHtml())}
          <p class="side-user">${u.fullName}</p>
          <button type="button" class="btn btn-sm btn-ghost-night side-out" id="logout">${t('a.nav.logout')}</button>
        </div>
      </aside>
      <div class="content">
        <header class="chrome glass-light">
          <h1 class="title-1" id="page-title"></h1>
          <div class="chrome-right">
            <span class="conn" id="conn" hidden></span>
            <div class="page-actions" id="page-actions"></div>
            <button type="button" class="icon-btn profile-btn" id="profile-btn" aria-label="${t('a.nav.profile')}" aria-haspopup="dialog">${raw(icon('gear-six', 22))}</button>
          </div>
        </header>
        <main id="main" class="page" tabindex="-1"></main>
      </div>
      <nav class="bottom-nav glass-light" aria-label="${t('a.nav.main')}">${navHtml(active, 'bottom')}</nav>
    </div>
    <div id="toasts" class="toasts" role="status" aria-live="polite"></div>
    <div class="menu-sheet-scrim" id="profile-menu" role="dialog" aria-modal="true" aria-label="${t('a.nav.profile')}" hidden>
      <div class="menu-sheet">
        <p class="side-user">${u.fullName}</p>
        <a class="btn btn-secondary btn-block" href="/app/settings">${t('a.nav.settings')}</a>
        ${raw(langSwitcherHtml('on-light'))}
        <button type="button" class="btn btn-ghost btn-block" id="logout2">${t('a.nav.logout')}</button>
        <button type="button" class="btn btn-ghost btn-block" id="profile-close">${t('close')}</button>
      </div>
    </div>`);
  applyI18n(root);
  bindLangSwitch(root);
  $$('.lang-btn', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === getLang())));
  cleanups.push(onLang(() => void navigate(location.pathname + location.search, { replace: true })));

  $('#logout', root)!.addEventListener('click', logout);
  $('#logout2', root)!.addEventListener('click', logout);
  $<HTMLSelectElement>('#farm-sel', root)?.addEventListener('change', (e) => { setFarmId((e.target as HTMLSelectElement).value); void navigate('/app/map'); });
  const pm = $('#profile-menu', root)!;
  $('#profile-btn', root)!.addEventListener('click', () => { const h = openModal(pm, { opener: $('#profile-btn', root) }); pm.addEventListener('click', (e) => { if (e.target === pm || (e.target as Element).closest('a, #profile-close, #logout2')) h.close(); }); });

  // ---- banners (most severe first, the rest as "+n") ----
  const banners = $('#banners', root)!;
  const drawBanners = () => {
    const list: { cls: string; text: string; retry?: boolean }[] = [];
    if (net.waking) list.push({ cls: 'warn', text: t('a.banner.waking'), retry: true });
    else if (net.server) list.push({ cls: 'danger', text: t('a.banner.server'), retry: true });
    if (net.rateLimited) list.push({ cls: 'warn', text: t('a.banner.rate') });
    if (net.offline) list.push({ cls: 'info', text: t('a.banner.offline', { time: absTime(new Date(net.lastOk).toISOString()) }) });
    document.body.classList.toggle('is-offline', net.offline);
    if (!list.length) { banners.innerHTML = ''; return; }
    const [top, ...rest] = list;
    banners.innerHTML = html`<div class="banner banner-${top.cls}">${raw(icon(top.cls === 'info' ? 'wifi-slash' : 'warning', 20))}<span>${top.text}</span>${rest.length ? html`<span class="banner-more">${t('a.banner.more', { n: rest.length })}</span>` : ''}${top.retry ? html`<button type="button" class="btn btn-sm btn-secondary" id="banner-retry">${t('a.banner.retry')}</button>` : ''}</div>`.s;
    $('#banner-retry', banners)?.addEventListener('click', () => void navigate(location.pathname + location.search, { replace: true }));
  };
  drawBanners();
  cleanups.push(onNet(drawBanners));

  // ---- persistent "Демо" strip + demo-mode state (pilot-modes P2) ----
  const strip = $('#demo-strip', root)!;
  const drawStrip = () => {
    const s = getSim();
    if (!s || s.dataMode === 'REAL') { strip.hidden = true; strip.innerHTML = ''; document.body.classList.remove('is-demo'); return; }
    strip.hidden = false;
    document.body.classList.add('is-demo');
    strip.innerHTML = html`${raw(icon('stack', 20))}<span class="demo-strip-tag">${t('a.demo.tag')}</span> <span aria-hidden="true">·</span> <span>${s.dataMode === 'MANUAL' ? t('a.demo.strip.MANUAL') : t('a.demo.strip.AUTO')}</span>`.s;
    strip.setAttribute('aria-label', modeName(s.dataMode));
  };
  setSim(farm.dataMode ? { dataMode: farm.dataMode, running: false, speed: 1, herd: 8, until: null, demo: { animals: 0, alerts: 0 }, enabled: true } : null, farm.id);
  drawStrip();
  cleanups.push(onSim(drawStrip));
  void refreshSim(farm.id);
  const simTimer = window.setInterval(() => { if (!document.hidden) void refreshSim(farm.id); }, 15000);
  cleanups.push(() => { window.clearInterval(simTimer); document.body.classList.remove('is-demo'); });

  // ---- chrome: connection badge + alert counter ----
  const refreshChrome = async () => {
    try {
      const [devs, stats] = await Promise.all([get<CollarDto[]>('/devices'), get<{ activeTotal: number }>('/alerts/stats').catch(() => null)]);
      if (shellDead) return;
      const conn = $('#conn', root)!;
      if (devs.length) {
        const on = devs.filter((d) => d.status === 'ONLINE').length;
        conn.hidden = false;
        conn.innerHTML = `<span class="conn-long">${t('a.conn.long', { on, all: devs.length })}</span><span class="conn-short" aria-hidden="true">${t('a.conn.short', { on, all: devs.length })}</span>`;
      } else conn.hidden = true;
      if (stats) $$('[id^="alert-badge-"]', root).forEach((b) => { b.textContent = String(stats.activeTotal); b.hidden = stats.activeTotal === 0; });
    } catch { /* chrome extras are optional */ }
  };
  void refreshChrome();
  const chromeTimer = window.setInterval(() => void refreshChrome(), isDemoMode() ? 15000 : 60000);
  cleanups.push(() => window.clearInterval(chromeTimer));
  cleanups.push(() => document.body.classList.remove('is-offline'));

  return {
    root, main: $('#main', root)!, token: getToken(), farmId: farm.id, lang: getLang(), farm, user: u, isOwner,
    refreshChrome: () => void refreshChrome(),
    setActive(nav) {
      $$<HTMLElement>('[data-nav]', root).forEach((a) => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    },
    teardown() { cleanups.forEach((c) => c()); },
  };
}

const view: View = {
  async mount(root, ctx: RouteCtx) {
    root.className = 'app-root';
    document.title = 'Qamqor';
    if (!getToken()) { disposeShell(); void navigate(`/login?next=${encodeURIComponent(ctx.path + location.search)}`, { replace: true }); return; }
    if (ctx.path === '/app' || ctx.path === '/app/') { void navigate('/app/map', { replace: true }); return; }
    const match = ROUTES.map((r) => ({ r, m: r.re.exec(ctx.path) })).find((x) => x.m);
    const navCleanups: (() => void)[] = [];
    let viewCleanup: void | (() => void);
    let deadFlag = false;
    const dead = () => deadFlag || !ctx.alive();
    navCleanups.push(() => { deadFlag = true; });
    const cleanupNav = () => {
      navCleanups.forEach((c) => c());
      if (typeof viewCleanup === 'function') { const c = viewCleanup; viewCleanup = undefined; c(); }
    };
    const active = match?.r.nav ?? 'map';

    // warm shell for the same session, language and farm: keep it, swap only the content
    const reusable = !!shell && !!match && shell.root === root && root.contains(shell.main)
      && shell.token === getToken() && shell.lang === getLang() && shell.farmId === getFarmId();
    let sh: Shell | null;
    if (reusable) {
      sh = shell!;
      sh.setActive(active);
      // a fresh element each time: the previous view's late callbacks see their own element detached (isConnected false)
      const fresh = document.createElement('main');
      fresh.id = 'main'; fresh.className = 'page'; fresh.tabIndex = -1;
      sh.main.replaceWith(fresh);
      sh.main = fresh;
      const title = $('#page-title', root); if (title) title.textContent = '';
      const acts = $('#page-actions', root); if (acts) acts.innerHTML = '';
    } else {
      disposeShell();
      sh = await buildShell(root, dead, navCleanups, active);
      if (!sh) return cleanupNav;
      shell = sh;
    }

    const shellNow = sh;
    const main = shellNow.main;
    const actions = $('#page-actions', root)!;
    const actx: AppCtx = {
      farm: shellNow.farm, user: shellNow.user, isOwner: shellNow.isOwner, params: {}, query: ctx.query,
      setTitle: (s) => { if (dead()) return; $('#page-title', root)!.textContent = s; document.title = `${s} | Qamqor`; },
      setActions: (c) => { if (dead()) return; actions.innerHTML = typeof c === 'string' ? c : c.s; },
      refreshChrome: () => shellNow.refreshChrome(),
    };

    if (!match) { void navigate('/app/map', { replace: true }); return cleanupNav; }
    match.r.keys.forEach((k, i) => { actx.params[k] = decodeURIComponent(match.m![i + 1]); });
    try {
      const mod = await match.r.load();
      if (dead()) return cleanupNav;
      viewCleanup = await mod.mount(main, actx);
      if (dead() && typeof viewCleanup === 'function') { const c = viewCleanup; viewCleanup = undefined; c(); }
    } catch (e) {
      console.error('view failed:', e);
      // a stale hashed chunk after a deploy: reload once (guarded against loops), otherwise show a real way out
      if (reloadOnceOnChunkError(e)) return cleanupNav;
      if (!dead()) {
        main.innerHTML = html`<div class="state-block error" role="alert"><h2 class="title-2">${t('a.state.error')}</h2><p>${isChunkError(e) ? t('a.route.loadFailHint') : errText(e)}</p><button type="button" class="btn btn-primary" id="view-reload">${t('a.route.reload')}</button></div>`.s;
        $('#view-reload', main)?.addEventListener('click', () => location.reload());
      }
    }
    return cleanupNav;
  },
  dispose,
};

export const mount = view.mount;
