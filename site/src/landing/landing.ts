import '../styles/landing.css';
import { $, $$, html, raw, setHtml } from '../dom';
import { applyI18n, bindLangSwitch, langSwitcherHtml, onLang, t, tk } from '../i18n';
import { getMotionPref, isMotionOn, lowMemory, onMotionChange, saveDataOn, setMotionPref, setWatchdogLight, watchdogIsLight, type MotionPref } from '../motion';
import type { View } from '../router';
import { openModal } from '../ui/dialog';
import { CALLOUTS, SCENES, clamp, dimProgress, sceneAt, textOpacity } from './storyboard';
import type { StageApi } from './stage';

const POSTER_W = 1280;
const POSTER_H = 960;

const NAV = [
  { href: '#panel', key: 'l.nav.device' },
  { href: '#platform', key: 'l.nav.platform' },
  { href: '#specs', key: 'l.nav.specs' },
  { href: '#roadmap', key: 'l.nav.roadmap' },
];
const SIDES = ['center', 'left', 'right', 'left', 'bottom', 'left'];
const PLATFORM = [
  { id: 'map', file: 'map' },
  { id: 'herd', file: 'herd' },
  { id: 'alerts', file: 'alerts' },
  { id: 'collars', file: 'collars' },
] as const;
const SPECS = Array.from({ length: 12 }, (_, i) => i + 1);

function icon(name: 'menu' | 'close' | 'arrow'): string {
  const p = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    arrow: '<path d="M12 5v14m0 0l-6-6m6 6l6-6"/>',
  }[name];
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

const navLinks = (cls: string) => NAV.map((n) => html`<a class="${cls}" href="${n.href}" data-i18n="${n.key}"></a>`);
const motionSwitch = html`
  <div class="motion-switch" role="group" data-i18n-aria="l.foot.anim">
    ${(['system', 'on', 'off'] as MotionPref[]).map((m) => html`<button type="button" class="motion-btn" data-motion-pref="${m}" aria-pressed="false" data-i18n="l.motion.${m}"></button>`)}
  </div>`;

function sceneHtml(i: number) {
  const s = SCENES[i];
  const n = s.id;
  const side = SIDES[i];
  const staticImg = html`<img class="scene-static-img" src="/posters/scene-${n}.webp" width="${POSTER_W}" height="${POSTER_H}" alt="" data-i18n-alt="l.fig.poster" ${n === 1 ? '' : raw('loading="lazy"')} decoding="async">`;
  const cap = (key: string) => html`<p class="caption scene-cap" data-i18n="${key}"></p>`;
  let body;
  switch (n) {
    case 1:
      body = html`
        <span class="chip" data-i18n="l.hero.chip"></span>
        <h1 class="hero-title" data-i18n="l.hero.title"></h1>
        <p class="lead" data-i18n="l.hero.lead"></p>
        <div class="hero-cta">
          <a class="btn btn-light" href="/register" data-i18n="l.hero.cta"></a>
          <a class="btn btn-ghost-night" href="#panel" data-scene-link="2" data-i18n="l.hero.how"></a>
        </div>`;
      break;
    case 2: body = html`<h2 class="scene-title" data-i18n="l.s2.title"></h2><p class="body-text" data-i18n="l.s2.body"></p>${cap('l.s2.cap')}`; break;
    case 3: body = html`<h2 class="scene-title" data-i18n="l.s3.title"></h2><p class="body-text" data-i18n="l.s3.body"></p>${cap('l.s3.cap')}`; break;
    case 4: body = html`<h2 class="scene-title" data-i18n="l.s4.title"></h2><p class="body-text" data-i18n="l.s4.body"></p>`; break;
    case 5: body = html`<h2 class="scene-title" data-i18n="l.s5.title"></h2><p class="body-text" data-i18n="l.s5.body"></p>`; break;
    default:
      body = html`
        <h2 class="scene-title" data-i18n="l.s6.title"></h2>
        <div class="specs-big num">
          ${[['210', 'l.s6.length', 1], ['80', 'l.s6.width', 2], ['90', 'l.s6.height', 3]].map(([v, k, d]) => html`
            <div class="spec-big" style="--d: var(--d${d})"><span class="spec-num">${v}</span><span class="spec-unit" data-i18n="l.unit.mm"></span><span class="spec-label" data-i18n="${k as string}"></span></div>`)}
        </div>
        <p class="lead" data-i18n="l.s6.lead"></p>
        <span class="chip" data-i18n="l.s6.chip"></span>
        ${cap('l.s6.cap')}`;
  }
  return html`
    <article class="scene scene-${n} side-${side}" data-scene="${n}" id="${n === 1 ? 'scene-1' : n === 2 ? 'panel' : `scene-${n}`}">
      <div class="scene-card glass-dark on-night">${body}</div>
      <div class="scene-static">${staticImg}</div>
    </article>`;
}

const template = () => html`
  <a class="skip-link" href="#main" data-i18n="a11y.skip"></a>
  <header class="site-header glass-dark on-night" id="site-header">
    <a class="brand" href="/" data-i18n="brand" aria-label="Qamqor"></a>
    <nav class="hnav" data-i18n-aria="l.nav.aria" aria-label="${t('l.nav.aria')}">${navLinks('hnav-link')}</nav>
    <div class="h-actions">
      <span class="h-lang">${raw(langSwitcherHtml())}</span>
      <a class="btn btn-sm btn-ghost-night h-login" href="/login" data-i18n="nav.login"></a>
      <a class="btn btn-sm btn-light h-register" href="/register" data-i18n="nav.register"></a>
      <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu" data-i18n-aria="l.menu.open">${raw(icon('menu'))}</button>
    </div>
  </header>

  <div class="menu on-night" id="menu" role="dialog" aria-modal="true" aria-labelledby="menu-title" hidden>
    <div class="menu-panel">
      <div class="menu-head">
        <h2 id="menu-title" class="menu-title" data-i18n="l.menu.title"></h2>
        <button type="button" class="menu-btn" id="menu-close" data-i18n-aria="l.menu.close">${raw(icon('close'))}</button>
      </div>
      <nav data-i18n-aria="l.nav.aria" aria-label="${t('l.nav.aria')}" class="menu-nav">${navLinks('menu-link')}</nav>
      ${raw(langSwitcherHtml())}
      ${motionSwitch}
      <div class="menu-actions">
        <a class="btn btn-light btn-block" href="/register" data-i18n="nav.register"></a>
        <a class="btn btn-ghost-night btn-block" href="/login" data-i18n="nav.login"></a>
      </div>
    </div>
  </div>

  <main id="main">
    <div class="stage" id="stage">
      <div class="stage-sticky" id="stage-sticky">
        <div class="stage-fig-wrap">
          <figure class="stage-fig" id="stage-fig" role="img" aria-label="${t('l.fig.aria', { scene: t('l.hero.title') })}">
            <img class="stage-poster" data-poster="1" src="/posters/scene-1.webp" width="${POSTER_W}" height="${POSTER_H}" alt="" fetchpriority="high" decoding="async">
            ${SCENES.slice(1).map((s) => html`<img class="stage-poster" data-poster="${s.id}" data-src="/posters/scene-${s.id}.webp" width="${POSTER_W}" height="${POSTER_H}" alt="" decoding="async">`)}
            <canvas id="stage-canvas" aria-hidden="true"></canvas>
          </figure>
          <svg class="leaders" aria-hidden="true" focusable="false"></svg>
          <svg class="dims" aria-hidden="true" focusable="false">
            ${['length', 'width', 'height'].map((d) => html`<path data-dim-line="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" d="M0 0L0 0"/><path data-dim-ticks="${d}" opacity="0" d="M0 0L0 0"/>`)}
          </svg>
          <div class="callouts" aria-hidden="true">
            ${CALLOUTS.map((c) => html`<div class="callout glass-dark on-night" data-co="${c.id}" data-on="0"><span data-i18n="${c.key}"></span></div>`)}
            ${[['length', '210'], ['width', '80'], ['height', '90']].map(([d, v]) => html`<div class="dim-label glass-dark on-night num" data-dim-label="${d}" data-on="0">${v} <span data-i18n="l.unit.mm"></span></div>`)}
          </div>
        </div>
        <div class="scenes">${SCENES.map((_, i) => sceneHtml(i))}</div>
        <nav class="rail" id="rail" data-i18n-aria="l.rail.aria" aria-label="${t('l.rail.aria')}">
          ${SCENES.map((s) => html`<a href="#${s.id === 2 ? 'panel' : `scene-${s.id}`}" data-scene-link="${s.id}" data-i18n-aria="${s.titleKey}" aria-label="${t(s.titleKey as never)}"><span class="rail-dot"></span></a>`)}
        </nav>
        <div class="scroll-hint caption" id="scroll-hint" aria-hidden="true"><span data-i18n="l.hero.scroll"></span>${raw(icon('arrow'))}</div>
        <p class="caption model-slow glass-dark on-night" id="model-slow" role="status" hidden data-i18n="l.model.slow"></p>
      </div>
    </div>

    <div class="fade fade-n2l" aria-hidden="true"></div>
    <section class="section light" id="platform" aria-labelledby="platform-h">
      <div class="container">
        <header class="section-head">
          <h2 class="h2" id="platform-h" data-i18n="l.plat.title"></h2>
          <p class="lead section-lead" data-i18n="l.plat.lead"></p>
        </header>
        <div class="plat-rows">
          ${PLATFORM.map((p) => html`
            <article class="plat-row">
              <div class="plat-text"><h3 class="h3" data-i18n="l.plat.${p.id}.t"></h3><p class="body-text" data-i18n="l.plat.${p.id}.b"></p></div>
              <figure class="plat-shot">
                <img src="/shots/${p.file}.webp" width="960" height="720" loading="lazy" decoding="async" alt="" data-i18n-alt="l.plat.shot.${p.id}">
                <figcaption class="caption" data-i18n="l.plat.shot"></figcaption>
              </figure>
            </article>`)}
        </div>
      </div>
    </section>

    <section class="section tone" aria-labelledby="roles-h">
      <div class="container">
        <h2 class="h2" id="roles-h" data-i18n="l.roles.title"></h2>
        <div class="roles">
          <article class="role role-owner"><h3 class="h3" data-i18n="l.roles.owner.t"></h3><p class="body-text" data-i18n="l.roles.owner.b"></p></article>
          <article class="role role-worker"><h3 class="h3" data-i18n="l.roles.worker.t"></h3><p class="body-text" data-i18n="l.roles.worker.b"></p></article>
        </div>
      </div>
    </section>
    <div class="fade fade-l2n" aria-hidden="true"></div>

    <section class="section night-1 on-night" id="specs" aria-labelledby="specs-h">
      <div class="container">
        <h2 class="h2" id="specs-h" data-i18n="l.specs.title"></h2>
        <dl class="specs">
          ${SPECS.map((n) => html`<div class="spec-row"><dt data-i18n="l.specs.r${n}.k"></dt><dd class="num" data-i18n="l.specs.r${n}.v"></dd></div>`)}
        </dl>
        <p class="caption spec-note" data-i18n="l.specs.note"></p>
      </div>
    </section>

    <section class="section night-0 on-night" id="roadmap" aria-labelledby="road-h">
      <div class="container narrow">
        <h2 class="h2" id="road-h" data-i18n="l.road.title"></h2>
        <p class="lead section-lead" data-i18n="l.road.body"></p>
        <ul class="road-list">${[1, 2, 3, 4].map((n) => html`<li data-i18n="l.road.i${n}"></li>`)}</ul>
      </div>
    </section>
    <div class="fade fade-n2l" aria-hidden="true"></div>

    <section class="section light cta" aria-labelledby="cta-h">
      <div class="container narrow">
        <h2 class="h2" id="cta-h" data-i18n="l.cta.title"></h2>
        <p class="lead section-lead" data-i18n="l.cta.body"></p>
        <div class="cta-actions">
          <a class="btn btn-primary" href="/register" data-i18n="nav.register"></a>
          <a class="btn btn-secondary" href="/login" data-i18n="nav.login"></a>
        </div>
      </div>
    </section>
  </main>
  <div class="fade fade-l2n" aria-hidden="true"></div>

  <footer class="site-footer on-night">
    <div class="container foot">
      <a class="brand" href="/" aria-label="Qamqor" data-i18n="brand"></a>
      <p class="foot-line" data-i18n="l.foot.line"></p>
      <div class="foot-controls">
        ${raw(langSwitcherHtml())}
        <div class="foot-motion"><span class="foot-motion-label" data-i18n="l.foot.anim"></span>${motionSwitch}</div>
      </div>
    </div>
  </footer>

  <div class="light-notice glass-dark on-night" id="light-notice" role="status" hidden>
    <span data-i18n="l.light.notice"></span>
    <button type="button" class="btn btn-sm btn-light" id="light-enable" data-i18n="l.light.enable"></button>
  </div>`;

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const view: View = {
  mount(root) {
    root.classList.add('landing');
    setHtml(root, template());
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(type, fn, opts);
      cleanups.push(() => window.removeEventListener(type, fn));
    };

    const setTitle = () => { document.title = `Qamqor | ${t('l.hero.title')}`; };
    setTitle();
    applyI18n(root);
    bindLangSwitch(root);
    cleanups.push(onLang(() => { setTitle(); updateFigLabel(true); }));

    // ---- elements ----
    const stage = $('#stage', root)!;
    const sticky = $('#stage-sticky', root)!;
    const fig = $('#stage-fig', root)!;
    const canvas = $<HTMLCanvasElement>('#stage-canvas', root)!;
    const articles = $$('.scene', root);
    const posters = $$<HTMLImageElement>('.stage-poster', root);
    const railLinks = $$('#rail a', root);
    const hint = $('#scroll-hint', root)!;
    const slow = $('#model-slow', root)!;
    const header = $('#site-header', root)!;
    const lightNotice = $('#light-notice', root)!;
    const heroPoster = posters[0];

    // ---- layout mode: scroll storyboard vs static blocks ----
    let live = false; // the canvas has drawn a frame
    let failed = false;
    let stageApi: StageApi | null = null;
    let loading = false;
    let lastScene = -1;

    const layoutStatic = () => !isMotionOn() || failed;
    function applyLayout(): void {
      root.dataset.layout = layoutStatic() ? 'static' : 'scroll';
      $$('[data-motion-pref]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.motionPref === getMotionPref())));
      lightNotice.hidden = !(watchdogIsLight() && getMotionPref() !== 'on');
      stageApi?.setActive(!layoutStatic());
      if (!layoutStatic()) { void maybeLoadStage(); schedule(); }
    }
    cleanups.push(onMotionChange(applyLayout));

    // ---- header height for scroll padding ----
    const setHeaderH = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight + 12}px`);
    setHeaderH();
    on('resize', setHeaderH);

    // ---- scroll driver ----
    let ticking = false;
    let top = 0, total = 1;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      top = r.top + window.scrollY;
      total = Math.max(1, stage.offsetHeight - window.innerHeight);
    };
    const progress = () => clamp((window.scrollY - top) / total);

    function updateFigLabel(force = false): void {
      const i = sceneAt(progress());
      if (i === lastScene && !force) return;
      lastScene = i;
      fig.setAttribute('aria-label', t('l.fig.aria', { scene: tk(SCENES[i].titleKey) }));
      railLinks.forEach((a, k) => (k === i ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current')));
      posters.forEach((p, k) => p.classList.toggle('on', k === i));
      if (!live && posters[i]?.dataset.src && !posters[i].src) posters[i].src = posters[i].dataset.src!;
    }

    function update(): void {
      ticking = false;
      if (layoutStatic()) { root.style.removeProperty('--d1'); return; }
      const P = progress();
      articles.forEach((a, k) => {
        const o = textOpacity(k, P);
        a.style.setProperty('--o', o.toFixed(3));
        const act = o > 0.5;
        if (a.dataset.active !== (act ? '1' : '0')) {
          a.dataset.active = act ? '1' : '0';
          $$('a, button', a).forEach((n) => (act ? n.removeAttribute('tabindex') : n.setAttribute('tabindex', '-1')));
        }
      });
      const [d1, d2, d3] = dimProgress(P);
      root.style.setProperty('--d1', d1.toFixed(3));
      root.style.setProperty('--d2', d2.toFixed(3));
      root.style.setProperty('--d3', d3.toFixed(3));
      root.dataset.rail = window.scrollY >= top - 40 && window.scrollY < top + total + 40 ? 'on' : 'off';
      hint.classList.toggle('gone', window.scrollY > 24);
      updateFigLabel();
      stageApi?.setProgress(P);
    }
    function schedule(): void { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    on('scroll', schedule, { passive: true });
    on('resize', () => { measure(); schedule(); });
    measure();

    // rail, "how it works" button and nav anchors to scenes
    function scrollToScene(n: number): void {
      const s = SCENES[n - 1];
      if (layoutStatic()) { articles[n - 1].scrollIntoView({ behavior: isMotionOn() ? 'smooth' : 'auto' }); return; }
      measure();
      const y = top + (s.a + 0.02) * total;
      window.scrollTo({ top: y, behavior: isMotionOn() ? 'smooth' : 'auto' });
    }
    root.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-scene-link], a[href="#panel"]');
      if (!a) return;
      e.preventDefault();
      closeMenu();
      scrollToScene(Number(a.dataset.sceneLink ?? 2));
    });

    // ---- mobile menu dialog ----
    const menu = $('#menu', root)!;
    const menuBtn = $('#menu-btn', root)!;
    let menuHandle: { close(): void } | null = null;
    function closeMenu(): void { menuHandle?.close(); }
    menuBtn.addEventListener('click', () => {
      menuBtn.setAttribute('aria-expanded', 'true');
      menuHandle = openModal(menu, { opener: menuBtn, onClose: () => { menuBtn.setAttribute('aria-expanded', 'false'); menuHandle = null; } });
    });
    $('#menu-close', root)!.addEventListener('click', closeMenu);
    $$('.menu-link, .menu-actions a', root).forEach((a) => a.addEventListener('click', () => { if (menuHandle) closeMenu(); }));
    cleanups.push(() => menuHandle?.close());

    // ---- motion switch (menu + footer) ----
    $$('[data-motion-pref]', root).forEach((b) => b.addEventListener('click', () => { failed = failed && b.dataset.motionPref !== 'on'; setMotionPref(b.dataset.motionPref as MotionPref); applyLayout(); }));
    $('#light-enable', root)!.addEventListener('click', () => { failed = false; setMotionPref('on'); applyLayout(); });

    // ---- lazy three.js stage ----
    function posterReady(): Promise<void> {
      return new Promise((res) => {
        if (heroPoster.complete) return res();
        heroPoster.addEventListener('load', () => res(), { once: true });
        heroPoster.addEventListener('error', () => res(), { once: true });
      });
    }
    const idle = (): Promise<void> => new Promise((res) => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      if (ric) ric(() => res(), { timeout: 1500 }); else setTimeout(res, 300);
    });

    let slowTimer = 0;
    async function maybeLoadStage(): Promise<void> {
      if (stageApi || loading || failed) return;
      if (saveDataOn() || lowMemory() || !webglAvailable()) {
        if (getMotionPref() !== 'on') { failed = true; root.dataset.layout = 'static'; return; }
      }
      loading = true;
      try {
        await posterReady();
        await idle();
        while (document.hidden) await new Promise<void>((r) => document.addEventListener('visibilitychange', () => r(), { once: true }));
        if (layoutStatic() || !root.isConnected) { loading = false; return; }
        slowTimer = window.setTimeout(() => {
          if (!live) { slow.hidden = false; posters.forEach((p) => { if (p.dataset.src && !p.src) p.src = p.dataset.src; }); }
        }, 8000);
        const glb = fetch('/models/qamqor.glb').then((r) => { if (!r.ok) throw new Error(`GLB ${r.status}`); return r.arrayBuffer(); });
        const mod = await import('./stage');
        if (!root.isConnected) return;
        const api = await mod.createStage({
          canvas, root: sticky, glb,
          onFirstFrame: () => { live = true; window.clearTimeout(slowTimer); slow.hidden = true; fig.dataset.live = '1'; },
          onLost: () => { live = false; fig.dataset.live = '0'; },
          onRestored: () => { live = true; fig.dataset.live = '1'; },
          onLightStep: (step) => { if (step === 3) { stageApi?.setActive(false); setWatchdogLight(); } },
        });
        if (!root.isConnected) { api.dispose(); return; }
        stageApi = api;
        if (import.meta.env.DEV) (window as unknown as { __stage?: StageApi }).__stage = api; // used by scripts/bake-posters.mjs
        stageApi.setActive(!layoutStatic());
        schedule();
      } catch (err) {
        console.warn('[site] 3D stage unavailable, static posters are shown:', err);
        failed = true;
        window.clearTimeout(slowTimer);
        applyLayout();
      } finally { loading = false; }
    }

    applyLayout();
    updateFigLabel(true);
    schedule();

    // keep GPU work off screen
    const io = new IntersectionObserver((es) => { stageApi?.setActive(es.some((e) => e.isIntersecting) && !layoutStatic()); });
    io.observe(stage);
    cleanups.push(() => io.disconnect());

    // direct links to a scene (/#panel)
    if (location.hash === '#panel' || /^#scene-\d$/.test(location.hash)) {
      const n = location.hash === '#panel' ? 2 : Number(location.hash.slice(-1));
      requestAnimationFrame(() => scrollToScene(n));
    }

    return () => {
      cleanups.forEach((c) => c());
      window.clearTimeout(slowTimer);
      stageApi?.dispose();
      stageApi = null;
      document.documentElement.style.removeProperty('--header-h');
      delete document.documentElement.dataset.light;
    };
  },
};

export const mount = view.mount;
