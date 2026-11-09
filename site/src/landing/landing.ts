import '../styles/landing.css';
import '../styles/landing-sections.css';
import { $, $$, html, raw, setHtml } from '../dom';
import { LANGS, applyI18n, bindLangSwitch, getLang, langSwitcherHtml, onLang, t, tk } from '../i18n';
import { getMotionPref, isMotionOn, lowMemory, onMotionChange, saveDataOn, setMotionPref, setWatchdogLight, watchdogIsLight, type MotionPref } from '../motion';
import type { View } from '../router';
import { openModal } from '../ui/dialog';
import { CALLOUTS, SCENES, beamAt, clamp, dimProgress, sceneAt, textOpacity } from './storyboard';
import type { StageApi } from './stage';
import { stats } from './stats';
import { APP_LINKS } from './app-links';
import { icon as phIcon } from '../ui/icons';
import { initFx, countUp } from './fx';
import { bgfx, initBgFx } from './bgfx';
import '../styles/landing-fx.css';

const POSTER_W = 1280;
const POSTER_H = 960;

const NAV = [
  { href: '#how', key: 'l.nav.how' },
  { href: '#app', key: 'l.nav.app' },
  { href: '#specs', key: 'l.nav.specs' },
  { href: '#roadmap', key: 'l.nav.roadmap' },
  { href: '#faq', key: 'l.nav.faq' },
];
const SIDES = ['center', 'left', 'right', 'left', 'bottom', 'left'];
/** Responsive WebP photo: 800 w on phones, 1400 w otherwise. Alt text is a locale key. */
function photo(name: string, altKey: string, cls: string, eager = false) {
  return html`<picture class="${cls}">
    <source media="(max-width: 767px)" srcset="/img/${name}-800.webp">
    <img src="/img/${name}-1400.webp" width="1400" height="764" alt="" data-i18n-alt="${altKey}" decoding="async" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy"')}>
  </picture>`;
}
const SPECS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Landing icons are Phosphor regular too (src/ui/icons.ts): chev = caret-down, arrow = arrow-down. */
function icon(name: 'chev' | 'arrow' | 'plus'): string {
  return phIcon({ chev: 'caret-down', arrow: 'arrow-down', plus: 'plus' }[name], 24);
}

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
      <div class="scene-card on-night">${body}</div>
      <div class="scene-static">${staticImg}</div>
    </article>`;
}

const template = () => html`
  <a class="skip-link" href="#main" data-i18n="a11y.skip"></a>
  <div class="dotfield dotfield-page" aria-hidden="true"><canvas></canvas></div>
  <header class="site-header on-night" id="site-header" data-scrolled="0">
    <div class="container hdr-in">
      <a class="brand hdr-i" style="--i:0" href="/" data-i18n="brand" aria-label="Qamqor"></a>
      <nav class="hnav" data-i18n-aria="l.nav.aria" aria-label="${t('l.nav.aria')}">${NAV.map((n, i) => html`<a class="hnav-link hdr-i" style="--i:${i + 1}" href="${n.href}" data-nav="${n.href.slice(1)}" data-i18n="${n.key}"></a>`)}</nav>
      <div class="h-actions hdr-i" style="--i:6">
        <div class="lang-dd h-lang" id="lang-dd">
          <button type="button" class="lang-dd-btn" id="lang-btn" aria-expanded="false" aria-controls="lang-panel" data-i18n-aria="lang.label"><span id="lang-cur"></span>${raw(icon('chev'))}</button>
          <div class="lang-panel" id="lang-panel" role="group" data-i18n-aria="lang.label" hidden>
            ${LANGS.map((l) => html`<button type="button" class="lang-opt" lang="${l}" data-set-lang="${l}" data-lang-current="${l}" data-i18n="lang.${l}"></button>`)}
          </div>
        </div>
        <a class="h-login" href="/login" data-i18n="nav.login"></a>
        <a class="btn btn-sm btn-light h-register" href="/register" data-i18n="nav.register"></a>
        <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu" aria-label="${t('l.menu.open')}"><i></i><i></i></button>
      </div>
    </div>
    <span class="hdr-progress" id="hdr-progress" aria-hidden="true"></span>
    <div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="${t('l.menu.title')}" data-i18n-aria="l.menu.title" hidden>
      <nav class="menu-nav" data-i18n-aria="l.nav.aria" aria-label="${t('l.nav.aria')}">${NAV.map((n, i) => html`<a class="menu-link" style="--i:${i}" href="${n.href}" data-i18n="${n.key}"></a>`)}</nav>
      <div class="menu-actions" style="--i:5">
        <a class="btn btn-ghost-night btn-block menu-cta" href="/login" data-i18n="nav.login"></a>
        <a class="btn btn-light btn-block menu-cta" href="/register" data-i18n="nav.register"></a>
      </div>
      <div style="--i:6">${raw(langSwitcherHtml('menu-lang'))}</div>
    </div>
  </header>

  <main id="main">
    <div class="stage" id="stage">
      <div class="stage-sticky" id="stage-sticky">
        <div class="stage-bg" id="stage-bg">${photo('hero-steppe', 'l.alt.hero', 'photo', true)}<div class="dotfield" aria-hidden="true"><canvas></canvas></div>${bgfx({ topo: 13, aurora: true, dust: 'beam', radar: { x: '50%', y: '54%', sweep: true }, edge: false })}</div>
        <div class="stage-light" aria-hidden="true"></div>
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
            ${CALLOUTS.map((c) => html`<div class="callout card-night on-night" data-co="${c.id}" data-on="0"><span data-i18n="${c.key}"></span></div>`)}
            ${[['length', '210'], ['width', '80'], ['height', '90']].map(([d, v]) => html`<div class="dim-label card-night on-night num" data-dim-label="${d}" data-on="0">${v} <span data-i18n="l.unit.mm"></span></div>`)}
          </div>
        </div>
        <div class="scenes">${SCENES.map((_, i) => sceneHtml(i))}</div>
        <nav class="rail" id="rail" data-i18n-aria="l.rail.aria" aria-label="${t('l.rail.aria')}">
          ${SCENES.map((s) => html`<a href="#${s.id === 2 ? 'panel' : `scene-${s.id}`}" data-scene-link="${s.id}" data-i18n-aria="${s.titleKey}" aria-label="${t(s.titleKey as never)}"><span class="rail-dot"></span></a>`)}
        </nav>
        <div class="scroll-hint caption" id="scroll-hint" aria-hidden="true"><span data-i18n="l.hero.scroll"></span>${raw(icon('arrow'))}</div>
        <p class="caption model-slow card-night on-night" id="model-slow" role="status" hidden data-i18n="l.model.slow"></p>
      </div>
    </div>

    <section class="section night-0 on-night has-bgfx" id="problems" aria-labelledby="prob-h">
      ${bgfx({ photo: 'night-road-cow', scrim: 0.4, topo: 1, aurora: true, dust: 'free' })}
      <div class="container">
        <header class="section-head">
          <h2 class="h2" id="prob-h" data-i18n="l.prob.title"></h2>
          <p class="lead section-lead" data-i18n="l.prob.lead"></p>
        </header>
        <ul class="prob-list">
          ${[1, 2, 3, 4].map((n) => html`<li class="prob"><h3 class="h3" data-i18n="l.prob.${n}.t"></h3><p class="body-text" data-i18n="l.prob.${n}.b"></p></li>`)}
        </ul>
        <div class="stats-block">
          <h3 class="stats-title" data-i18n="l.stats.title"></h3>
          <ul class="stats">
            ${stats.map((st) => html`<li class="stat lit card-night">
              <p class="stat-n num" data-i18n="l.stats.${st.id}.n"></p>
              <p class="stat-t" data-i18n="l.stats.${st.id}.t"></p>
              <p class="stat-s caption"><span data-i18n="l.stats.src"></span>: <a href="${st.href}" target="_blank" rel="noopener noreferrer" data-i18n="l.stats.${st.id}.s"></a></p>
            </li>`)}
          </ul>
        </div>
      </div>
    </section>

    <section class="section night-1 on-night has-bgfx" id="how" aria-labelledby="how-h">
      ${bgfx({ photo: 'aerial-pasture', scrim: 0.68, topo: 2, radar: { x: '82%', y: '38%', sweep: true } })}
      <div class="container">
        <header class="section-head">
          <h2 class="h2" id="how-h" data-i18n="l.how.title"></h2>
          <p class="lead section-lead" data-i18n="l.how.lead"></p>
        </header>
        <ol class="how-list">
          ${[1, 2, 3, 4, 5, 6].map((n) => html`<li class="how-step"><p class="body-text" data-i18n="l.how.${n}"></p></li>`)}
        </ol>
        <p class="how-note caption" data-i18n="l.how.note"></p>
      </div>
    </section>

    <section class="section night-0 on-night has-bgfx" id="animals" aria-labelledby="an-h">
      ${bgfx({ photo: 'hero-steppe', scrim: 0.64, pos: '50% 40%', topo: 3, aurora: true })}
      <div class="container">
        <header class="section-head">
          <h2 class="h2" id="an-h" data-i18n="l.an.title"></h2>
          <p class="lead section-lead" data-i18n="l.an.lead"></p>
        </header>
        <div class="animals">
          ${[['cow', 'cow-portrait', 'l.alt.cow', true], ['camel', 'camels', 'l.alt.camels', false], ['horse', 'horses', 'l.alt.horses', false]].map(([k, f, alt, primary]) => html`
            <figure class="animal${primary ? ' animal-main' : ''}">
              ${photo(f as string, alt as string, 'photo')}
              <figcaption><h3 class="h3" data-i18n="l.an.${k}.t"></h3><p class="body-text" data-i18n="l.an.${k}.b"></p></figcaption>
            </figure>`)}
        </div>
      </div>
    </section>

    <section class="section night-1 on-night has-bgfx" id="safety" aria-labelledby="safe-h">
      ${bgfx({ photo: 'cow-portrait', flip: true, pos: '20% 50%', scrim: 0.6, topo: 4, fence: true, dust: 'free' })}
      <div class="container">
        <header class="section-head">
          <h2 class="h2" id="safe-h" data-i18n="l.safe.title"></h2>
          <p class="lead section-lead" data-i18n="l.safe.lead"></p>
        </header>
        <div class="safe-grid">
          <ul class="safe-list">${[1, 2, 3, 4, 5].map((n) => html`<li class="body-text" data-i18n="l.safe.${n}"></li>`)}</ul>
          <div class="safe-side">
            <p class="body-text safe-server" data-i18n="l.safe.server"></p>
            <div class="adapt">
              <h3 class="h3" data-i18n="l.safe.adapt.t"></h3>
              <p class="body-text" data-i18n="l.safe.adapt.b"></p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section light sheet has-bgfx" id="app" aria-labelledby="app-h" data-sheet>
      ${bgfx({ tone: 'light', photo: 'aerial-pasture', topo: 5, aurora: true })}
      <div class="container">
        <h2 class="h2" id="app-h" data-i18n="l.app.title"></h2>
        <ul class="app-list">
          <li class="app-item">
            <h3 class="h3" data-i18n="l.app.android"></h3>
            ${APP_LINKS.android
              ? html`<a class="btn btn-primary" href="${APP_LINKS.android}" rel="noopener" download="qamqor.apk"><span data-i18n="l.app.android.get"></span>&nbsp;<span class="app-size" data-i18n="l.app.android.size"></span></a>
                <p class="app-note" data-i18n="l.app.android.note"></p>`
              : html`<p class="status-chip" data-i18n="l.app.android.status"></p>`}
          </li>
          <li class="app-item">
            <h3 class="h3" data-i18n="l.app.ios"></h3>
            <p class="status-chip" data-i18n="l.app.ios.status"></p>
          </li>
          <li class="app-item">
            <h3 class="h3" data-i18n="l.app.web"></h3>
            <a class="btn btn-primary" href="/login" data-i18n="l.app.web.open"></a>
          </li>
        </ul>
      </div>
    </section>

    <section class="section tone has-bgfx" aria-labelledby="roles-h">
      ${bgfx({ tone: 'light', topo: 6, aurora: true })}
      <div class="container">
        <h2 class="h2" id="roles-h" data-i18n="l.roles.title"></h2>
        <div class="roles">
          <article class="role role-owner"><h3 class="h3" data-i18n="l.roles.owner.t"></h3><p class="body-text" data-i18n="l.roles.owner.b"></p></article>
          <article class="role role-worker"><h3 class="h3" data-i18n="l.roles.worker.t"></h3><p class="body-text" data-i18n="l.roles.worker.b"></p></article>
        </div>
      </div>
    </section>
    <section class="section light has-bgfx" id="compare" aria-labelledby="cmp-h">
      ${bgfx({ tone: 'light', topo: 7, aurora: true })}
      <div class="container">
        <header class="section-head">
          <h2 class="h2" id="cmp-h" data-i18n="l.cmp.title"></h2>
          <p class="lead section-lead" data-i18n="l.cmp.lead"></p>
        </header>
        <table class="cmp">
          <thead><tr><th scope="col" data-i18n="l.cmp.h.sol"></th><th scope="col" data-i18n="l.cmp.h.pro"></th><th scope="col" data-i18n="l.cmp.h.con"></th></tr></thead>
          <tbody>
            ${[1, 2, 3, 4].map((n) => html`<tr class="${n === 4 ? 'cmp-us' : ''}">
              <th scope="row" data-i18n="l.cmp.r${n}.s"></th>
              <td><span class="cmp-label" data-i18n="l.cmp.h.pro"></span><span data-i18n="l.cmp.r${n}.p"></span></td>
              <td><span class="cmp-label" data-i18n="l.cmp.h.con"></span><span data-i18n="l.cmp.r${n}.c"></span></td>
            </tr>`)}
          </tbody>
        </table>
        <h3 class="h3 cmp-limits-title" data-i18n="l.cmp.limits"></h3>
        <ul class="cmp-limits">${[1, 2, 3, 4, 5, 6].map((n) => html`<li class="body-text" data-i18n="l.cmp.l${n}"></li>`)}</ul>
      </div>
    </section>

    <section class="section night-1 on-night sheet has-bgfx" id="specs" data-sheet aria-labelledby="specs-h">
      ${bgfx({ photo: 'night-road-cow', flip: true, pos: '60% 50%', scrim: 0.5, topo: 8, dust: 'free', radar: { x: '78%', y: '45%' } })}
      <div class="stage-light stage-light-static" aria-hidden="true"></div>
      <div class="container">
        <h2 class="h2" id="specs-h" data-i18n="l.specs.title"></h2>
        <dl class="specs">
          ${SPECS.map((n) => html`<div class="spec-row"><dt data-i18n="l.specs.r${n}.k"></dt><dd class="num" data-i18n="l.specs.r${n}.v"></dd></div>`)}
        </dl>
        <p class="caption spec-note" data-i18n="l.specs.note"></p>
      </div>
    </section>

    <section class="section night-0 on-night has-bgfx" id="roadmap" aria-labelledby="road-h">
      ${bgfx({ photo: 'hero-steppe', flip: true, pos: '30% 60%', scrim: 0.66, topo: 9, aurora: true })}
      <div class="container narrow">
        <h2 class="h2" id="road-h" data-i18n="l.road.title"></h2>
        <p class="lead section-lead" data-i18n="l.road.body"></p>
        <ol class="stages" data-i18n-aria="l.road.stages" aria-label="${t('l.road.stages')}">${[1, 2, 3, 4, 5, 6].map((n) => html`<li data-i18n="l.road.s${n}"></li>`)}</ol>
        <h3 class="h3 road-open" data-i18n="l.road.open"></h3>
        <ul class="road-list">${[1, 2, 3, 4].map((n) => html`<li data-i18n="l.road.i${n}"></li>`)}</ul>
        <div class="biz">
          <h3 class="h3" data-i18n="l.biz.title"></h3>
          <p class="lead" data-i18n="l.biz.body"></p>
        </div>
      </div>
    </section>
    <section class="section tone sheet has-bgfx" id="faq" data-sheet aria-labelledby="faq-h">
      ${bgfx({ tone: 'light', topo: 10, aurora: true })}
      <div class="container narrow">
        <h2 class="h2" id="faq-h" data-i18n="l.faq.title"></h2>
        <div class="faq">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`
            <div class="faq-item">
              <h3 class="faq-q"><button type="button" class="faq-btn" id="faq-b${n}" aria-expanded="false" aria-controls="faq-p${n}"><span data-i18n="l.faq.${n}.q"></span>${raw(icon('plus'))}</button></h3>
              <div class="faq-a" id="faq-p${n}" role="region" aria-labelledby="faq-b${n}" hidden><p class="body-text" data-i18n="l.faq.${n}.a"></p></div>
            </div>`)}
        </div>
      </div>
    </section>

    <section class="section light cta has-bgfx" aria-labelledby="cta-h">
      ${bgfx({ tone: 'light', photo: 'hero-steppe', pos: '50% 55%', topo: 11, aurora: true, radar: { x: '50%', y: '50%' } })}
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
  <footer class="site-footer on-night sheet has-bgfx" data-sheet>
    ${bgfx({ topo: 12, aurora: true })}
    <div class="container foot">
      <a class="brand" href="/" aria-label="Qamqor" data-i18n="brand"></a>
      <p class="foot-line" data-i18n="l.foot.line"></p>
      <div class="foot-controls">
        ${raw(langSwitcherHtml())}
        <div class="foot-motion"><span class="foot-motion-label" data-i18n="l.foot.anim"></span>${motionSwitch}</div>
      </div>
    </div>
  </footer>

  <div class="light-notice card-night on-night" id="light-notice" role="status" hidden>
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
    const fx = initFx(root);
    cleanups.push(() => fx.destroy());
    cleanups.push(initBgFx(root, fx));
    const langCur = $('#lang-cur', root)!;
    const setLangLabel = () => { langCur.textContent = getLang().toUpperCase(); };
    setLangLabel();
    cleanups.push(onLang(() => { setTitle(); updateFigLabel(true); setLangLabel(); }));

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
    const lightNotice = $('#light-notice', root)!;
    const heroPoster = posters[0];
    const stageBg = $('#stage-bg', root)!;

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

    // ---- scroll padding: the scrolled header (60) + 16 ----
    document.documentElement.style.setProperty('--header-h', '76px');

    // ---- scroll driver ----
    let needs = true;
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
      needs = false;
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
      stageBg.style.setProperty('--sp', P.toFixed(3));
      sticky.style.setProperty('--beam-a', beamAt(P).toFixed(3));
      const tl = $('.scene-title', articles[sceneAt(P)]);
      if (tl && !tl.classList.contains('in') && P > 0.001) tl.classList.add('in');
      if (d1 > 0) $$('.spec-num', root).forEach(countUp);
    }
    function schedule(): void { needs = true; fx.wake(); }
    fx.tick(() => { if (needs || fx.scrolled) update(); return false; });
    on('resize', () => { measure(); schedule(); });
    // beam tilt towards the cursor (fine pointers), smoothed
    let rot = 0;
    fx.tick(() => {
      const want = fx.pointer.fine && fx.pointer.active && isMotionOn() ? fx.pointer.nx * 2.5 : 0;
      rot += (want - rot) * 0.06;
      if (Math.abs(want - rot) < 0.005) rot = want;
      sticky.style.setProperty('--beam-rot', `${rot.toFixed(3)}deg`);
      return rot !== want;
    });
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
      scrollToScene(Number(a.dataset.sceneLink ?? 2));
    });

    // ---- FAQ accordion (button + region) ----
    $$('.faq-btn', root).forEach((b) => b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      document.getElementById(b.getAttribute('aria-controls')!)!.hidden = !open;
    }));

    // ---- parallax-lite for photo backgrounds (only while motion is on) ----
    const para = $$('[data-parallax]', root);
    function parallax(): void {
      const on = isMotionOn();
      for (const el of para) {
        if (!on) { el.style.removeProperty('--py'); continue; }
        const r = el.parentElement!.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const k = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        el.style.setProperty('--py', `${(k * -40).toFixed(1)}px`);
      }
    }
    fx.tick(() => { if (fx.scrolled) parallax(); return false; });
    cleanups.push(onMotionChange(parallax));
    parallax();

    // ---- mobile menu: full-screen dialog (focus trap, Esc, focus return come from openModal) ----
    const menu = $('#menu', root)!;
    const menuBtn = $('#menu-btn', root)!;
    let menuHandle: { close(): void } | null = null;
    function closeMenu(): void { menuHandle?.close(); }
    const menuLabel = () => menuBtn.setAttribute('aria-label', t(menuBtn.getAttribute('aria-expanded') === 'true' ? 'l.menu.close' : 'l.menu.open'));
    cleanups.push(onLang(menuLabel));
    menuBtn.addEventListener('click', () => {
      if (menuHandle) { closeMenu(); return; }
      const r = menuBtn.getBoundingClientRect();
      menu.style.setProperty('--ox', `${(r.left + r.width / 2).toFixed(0)}px`);
      menu.style.setProperty('--oy', `${(r.top + r.height / 2).toFixed(0)}px`);
      menuBtn.setAttribute('aria-expanded', 'true'); menuLabel();
      document.documentElement.style.overflow = 'hidden';
      menuHandle = openModal(menu, { opener: menuBtn, onClose: () => {
        menuBtn.setAttribute('aria-expanded', 'false'); menuLabel(); menuHandle = null;
        document.documentElement.style.overflow = '';
      } });
    });
    $$('.menu-link, .menu-cta', root).forEach((a) => a.addEventListener('click', () => { if (menuHandle) closeMenu(); }));
    on('resize', () => { if (menuHandle && window.innerWidth >= 1024) closeMenu(); });
    cleanups.push(() => menuHandle?.close());

    // ---- language dropdown (>= 1024): button + group of language buttons ----
    const dd = $('#lang-dd', root)!;
    const ddBtn = $('#lang-btn', root)!;
    const ddPanel = $('#lang-panel', root)!;
    const ddSet = (open: boolean, focusBack = false) => { ddPanel.hidden = !open; ddBtn.setAttribute('aria-expanded', String(open)); if (!open && focusBack) ddBtn.focus(); };
    ddBtn.addEventListener('click', () => ddSet(ddPanel.hasAttribute('hidden')));
    ddPanel.addEventListener('click', () => ddSet(false, true));
    dd.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ddPanel.hasAttribute('hidden')) { e.stopPropagation(); ddSet(false, true); } });
    dd.addEventListener('focusout', (e) => { if (!dd.contains(e.relatedTarget as Node | null)) ddSet(false); });
    on('pointerdown', (e) => { if (!dd.contains(e.target as Node)) ddSet(false); });

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
          canvas, root: sticky, glb, pointer: fx.pointer,
          onFirstFrame: () => { live = true; window.clearTimeout(slowTimer); slow.hidden = true; fig.dataset.live = '1'; },
          onLost: () => { live = false; fig.dataset.live = '0'; },
          onRestored: () => { live = true; fig.dataset.live = '1'; },
          onLightStep: (step) => { if (step === 3) { stageApi?.setActive(false); setWatchdogLight(); } },
        });
        if (!root.isConnected) { api.dispose(); return; }
        stageApi = api;
        if (import.meta.env.DEV) (window as unknown as { __stage?: StageApi }).__stage = api; // used by scripts/bake-posters.mjs
        stageApi.setActive(!layoutStatic());
        stageApi.setAmbient(isMotionOn());
        cleanups.push(onMotionChange((m) => stageApi?.setAmbient(m)));
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
