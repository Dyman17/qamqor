// Section background layers of the landing (owner request: no empty backgrounds).
// Template side: bgfx() returns the markup of a layered background (photo, tint, aurora, topographic lines, dust, radar, fence, edge).
// Runtime side: initBgFx() pauses off-screen layers, drives the dust canvases, draws the fence on scroll, adds the cursor glow and grain.
// Everything is decorative (aria-hidden). Without motion the layers stay as static art; photos stay.
import { html, raw, type Safe } from '../dom';
import { isMotionOn, onMotionChange, saveDataOn } from '../motion';
import { clamp } from './storyboard';
import type { Fx } from './fx';

export interface BgOpts {
  /** photo base name in /img (no people, no captions) */
  photo?: string;
  flip?: boolean;
  pos?: string;
  /** scrim strength 0..1 that keeps text >= 4.5:1 on this photo */
  scrim?: number;
  tone?: 'night' | 'light';
  /** topographic lines seed (0 = none) */
  topo?: number;
  aurora?: boolean;
  /** dust particles: 'beam' concentrates them in the spotlight cone */
  dust?: 'beam' | 'free';
  radar?: { x: string; y: string; sweep?: boolean };
  fence?: boolean;
  edge?: boolean;
}

// ---- topographic contours: seeded scalar field + marching squares, built once per seed ----
function mulberry32(a: number): () => number {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const topoCache = new Map<number, { minor: string; major: string }>();
function contours(seed: number): { minor: string; major: string } {
  const hit = topoCache.get(seed);
  if (hit) return hit;
  const W = 1200, H = 800, C = 25, rnd = mulberry32(seed * 7919 + 13);
  const peaks = Array.from({ length: 7 }, () => ({ x: rnd() * W, y: rnd() * H, s: 140 + rnd() * 230, a: 0.55 + rnd() * 0.8 }));
  const p0 = rnd() * 6.28, p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const f = (x: number, y: number) => {
    let v = 0;
    for (const p of peaks) v += p.a * Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (2 * p.s * p.s));
    return v + 0.13 * Math.sin(x * 0.011 + p0 + Math.sin(y * 0.008 + p1) * 1.7) * Math.cos(y * 0.012 + p2);
  };
  const nx = W / C + 1, ny = H / C + 1;
  const g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = f(i * C, j * C);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  let minor = '', major = '';
  for (let L = 0; L < 14; L++) {
    const lv = 0.1 + L * 0.1;
    let d = '';
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const tl = g[j * nx + i], tr = g[j * nx + i + 1], br = g[(j + 1) * nx + i + 1], bl = g[(j + 1) * nx + i];
      const idx = (tl > lv ? 8 : 0) | (tr > lv ? 4 : 0) | (br > lv ? 2 : 0) | (bl > lv ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = i * C, y0 = j * C;
      const T = () => [x0 + ((lv - tl) / (tr - tl)) * C, y0], R = () => [x0 + C, y0 + ((lv - tr) / (br - tr)) * C];
      const B = () => [x0 + ((lv - bl) / (br - bl)) * C, y0 + C], Lf = () => [x0, y0 + ((lv - tl) / (bl - tl)) * C];
      const seg = (a: number[], b: number[]) => { d += `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`; };
      switch (idx) {
        case 1: case 14: seg(Lf(), B()); break;
        case 2: case 13: seg(B(), R()); break;
        case 3: case 12: seg(Lf(), R()); break;
        case 4: case 11: seg(T(), R()); break;
        case 5: seg(Lf(), T()); seg(B(), R()); break;
        case 6: case 9: seg(T(), B()); break;
        case 7: case 8: seg(Lf(), T()); break;
        case 10: seg(Lf(), B()); seg(T(), R()); break;
      }
    }
    if (L % 4 === 0) major += d; else minor += d;
  }
  const out = { minor, major };
  topoCache.set(seed, out);
  return out;
}

// ---- virtual fence (decorative outline of a pasture; drawn on scroll) ----
const FENCE: [number, number][] = [[210, 250], [470, 150], [760, 190], [1010, 330], [960, 590], [690, 690], [380, 640], [170, 470]];
const FENCE_D = 'M' + FENCE.map((p) => p.join(' ')).join('L') + 'Z';
const PINGS: [number, number, number][] = [[430, 340, 0], [610, 460, 1.4], [800, 380, 0.7], [560, 560, 2.1], [340, 520, 1.1]];

export function bgfx(o: BgOpts): Safe {
  const tone = o.tone ?? 'night';
  const topo = o.topo ? contours(o.topo) : null;
  return html`<div class="bgfx bgfx-${tone}" aria-hidden="true" data-bgfx style="${o.scrim != null ? `--sa:${o.scrim}` : ''}">
    ${o.photo ? html`<div class="photo-bg" data-parallax>
      <picture class="photo${o.flip ? ' flip' : ''}">
        <source media="(max-width: 767px)" srcset="/img/${o.photo}-800.webp">
        <img src="/img/${o.photo}-1400.webp" width="1400" height="764" alt="" loading="lazy" decoding="async" fetchpriority="low" style="${o.pos ? `object-position:${o.pos}` : ''}">
      </picture></div><div class="bg-tint"></div>` : ''}
    ${o.aurora ? html`<div class="bg-aurora"><i></i><i></i><i></i></div>` : ''}
    ${topo ? html`<svg class="bg-topo" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" focusable="false"><path class="t-minor" d="${topo.minor}"/><path class="t-major" d="${topo.major}"/></svg>` : ''}
    ${o.radar ? html`<div class="bg-radar" style="--rx:${o.radar.x};--ry:${o.radar.y}">
      ${[0.3, 0.5, 0.7, 0.9].map((s, i) => html`<b style="--s:${s};--i:${i}"></b>`)}${o.radar.sweep ? html`<span class="sweep"></span>` : ''}</div>` : ''}
    ${o.fence ? html`<svg class="bg-fence" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" focusable="false">
      <path class="fence-glow" d="${FENCE_D}" pathLength="1"/>
      <path class="fence-line" d="${FENCE_D}" pathLength="1"/>
      ${FENCE.map((p, i) => html`<circle class="fence-post" cx="${p[0]}" cy="${p[1]}" r="6" style="--t:${(i / FENCE.length).toFixed(2)}"/>`)}
      ${PINGS.map((p) => html`<g class="fence-ping" style="--pd:${p[2]}s"><circle cx="${p[0]}" cy="${p[1]}" r="4"/><circle class="pr" cx="${p[0]}" cy="${p[1]}" r="14"/></g>`)}
    </svg>` : ''}
    ${o.dust ? html`<canvas class="bg-dust" data-dust="${o.dust}"></canvas>` : ''}
    <div class="bg-fade"></div>
    ${o.edge === false ? '' : raw('<i class="bg-edge"></i>')}
  </div>`;
}

// ---- runtime ----
interface P { x: number; y: number; r: number; a: number; ph: number; vy: number; vx: number }
interface Dust { c: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number; beam: boolean; ps: P[]; live: boolean; host: HTMLElement }

export function initBgFx(root: HTMLElement, fx: Fx): () => void {
  const cleanups: (() => void)[] = [];
  const docEl = document.documentElement;
  const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-bgfx]'));
  const mint = getComputedStyle(root).getPropertyValue('--mint').trim() || '#7FD6A0';

  // pause everything that is off screen or in a hidden tab
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const el = e.target as HTMLElement;
      el.classList.toggle('live', e.isIntersecting);
      const d = dusts.find((x) => x.host === el);
      if (d) d.live = e.isIntersecting;
    }
    fx.wake();
  }, { rootMargin: '120px 0px' });
  layers.forEach((l) => io.observe(l));
  cleanups.push(() => io.disconnect());
  const vis = () => { docEl.classList.toggle('tab-hidden', document.hidden); if (!document.hidden) fx.wake(); };
  document.addEventListener('visibilitychange', vis);
  cleanups.push(() => document.removeEventListener('visibilitychange', vis), () => docEl.classList.remove('tab-hidden'));

  // ---- dust canvases ----
  const dusts: Dust[] = [];
  const stageEl = root.querySelector<HTMLElement>('#stage-sticky');
  for (const c of Array.from(root.querySelectorAll<HTMLCanvasElement>('canvas.bg-dust'))) {
    const host = c.closest<HTMLElement>('[data-bgfx]')!;
    dusts.push({ c, g: c.getContext('2d')!, w: 0, h: 0, beam: c.dataset.dust === 'beam', ps: [], live: false, host });
  }
  const rnd = () => Math.random();
  function spawn(d: Dust, bx: number, top = false): P {
    const w = d.w, h = d.h;
    const y = top ? rnd() * h * 0.15 : rnd() * h;
    const half = d.beam ? (y + h * 0.1) * 0.22 + 20 : w / 2;
    const x = d.beam ? bx + (rnd() * 2 - 1) * half : rnd() * w;
    return { x, y, r: 0.6 + rnd() * 1.5, a: 0.25 + rnd() * 0.55, ph: rnd() * 6.28, vy: 0.004 + rnd() * 0.012, vx: (rnd() - 0.5) * 0.008 };
  }
  function size(d: Dust): void {
    const r = d.host.getBoundingClientRect();
    d.w = Math.max(1, r.width); d.h = Math.max(1, r.height);
    let dpr = Math.min(2, devicePixelRatio || 1);
    while (d.w * d.h * dpr * dpr > 3e6 && dpr > 1) dpr -= 0.25;
    d.c.width = Math.round(d.w * dpr); d.c.height = Math.round(d.h * dpr);
    d.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(d.beam ? 90 : 48, Math.round((d.w * d.h) / (d.beam ? 14000 : 26000)));
    d.ps = Array.from({ length: n }, () => spawn(d, beamX(d)));
    paint(d, 0, 0);
  }
  function beamX(d: Dust): number {
    if (!d.beam || !stageEl) return d.w / 2;
    const v = parseFloat(getComputedStyle(stageEl).getPropertyValue('--beam-x'));
    return Number.isFinite(v) ? v : d.w / 2;
  }
  function paint(d: Dust, now: number, dt: number): void {
    const { g, w, h, ps } = d;
    g.clearRect(0, 0, w, h);
    const bx = beamX(d);
    let px = -1e4, py = -1e4;
    if (dt && fx.pointer.fine && fx.pointer.active) { const r = d.c.getBoundingClientRect(); px = fx.pointer.x - r.left; py = fx.pointer.y - r.top; }
    g.fillStyle = mint;
    for (const p of ps) {
      if (dt) {
        p.y += p.vy * dt; p.x += (p.vx + Math.sin(now / 2200 + p.ph) * 0.006) * dt;
        const dx = p.x - px, dy = p.y - py, dd = dx * dx + dy * dy;
        if (dd < 14400 && dd > 1) { const k = (1 - Math.sqrt(dd) / 120) * 0.05 * dt; p.x += (dx / Math.sqrt(dd)) * k; p.y += (dy / Math.sqrt(dd)) * k; }
      }
      let f = 1;
      if (d.beam) {
        const half = (p.y + h * 0.1) * 0.22 + 20;
        f = Math.max(0.12, 1 - Math.abs(p.x - bx) / half);
        if (dt && (p.y > h * 0.95 || Math.abs(p.x - bx) > half * 1.4)) { Object.assign(p, spawn(d, bx, true)); }
      } else if (dt && (p.y > h + 4 || p.x < -4 || p.x > w + 4)) { p.y = -4; p.x = rnd() * w; }
      g.globalAlpha = p.a * f * (0.65 + 0.35 * Math.sin(now / 700 + p.ph)) * (d.beam ? 0.9 : 0.5);
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;
  }
  dusts.forEach(size);
  const ro = new ResizeObserver(() => dusts.forEach(size));
  dusts.forEach((d) => ro.observe(d.host));
  cleanups.push(() => ro.disconnect());
  let last = 0;
  fx.tick((now) => {
    if (!isMotionOn() || saveDataOn()) return false;
    const on = dusts.filter((d) => d.live);
    if (!on.length) { last = 0; return false; }
    if (now - last < 33) return true;
    const dt = last ? Math.min(64, now - last) : 16; last = now;
    on.forEach((d) => paint(d, now, dt));
    return true;
  });
  cleanups.push(onMotionChange(() => { dusts.forEach((d) => paint(d, 0, 0)); fx.wake(); }));

  // ---- virtual fence draws itself while the section scrolls into view ----
  const fences = Array.from(root.querySelectorAll<SVGSVGElement>('.bg-fence'));
  const fenceStep = () => {
    const on = isMotionOn();
    for (const s of fences) {
      const line = s.querySelector<SVGPathElement>('.fence-line')!, glow = s.querySelector<SVGPathElement>('.fence-glow')!;
      if (!on) { s.removeAttribute('data-fp'); s.style.removeProperty('--fp'); line.style.strokeDashoffset = ''; glow.style.strokeDashoffset = ''; continue; }
      const r = s.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) continue;
      const p = clamp((innerHeight * 0.92 - r.top) / (r.height * 0.7 + innerHeight * 0.1));
      s.setAttribute('data-fp', '1'); s.style.setProperty('--fp', p.toFixed(3));
      line.style.strokeDashoffset = (1 - p).toFixed(4); glow.style.strokeDashoffset = (1 - p).toFixed(4);
    }
  };
  fx.tick(() => { if (fx.scrolled) fenceStep(); return false; });
  cleanups.push(onMotionChange(fenceStep));
  fenceStep();

  // ---- cursor glow with lit dot grid (fixed, above every section; screen blend = invisible on light sections) ----
  const cur = document.createElement('div');
  cur.className = 'cursor-fx'; cur.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div');
  grain.className = 'grain'; grain.setAttribute('aria-hidden', 'true');
  root.append(cur, grain);
  cleanups.push(() => { cur.remove(); grain.remove(); });
  let cx = -1e4, cy = -1e4, ca = 0;
  fx.tick(() => {
    const ok = fx.pointer.fine && isMotionOn() && !saveDataOn();
    const target = ok && fx.pointer.active ? 1 : 0;
    if (ca === 0 && target === 0) return false;
    if (ca === 0) { cx = fx.pointer.x; cy = fx.pointer.y; }
    cx += (fx.pointer.x - cx) * 0.2; cy += (fx.pointer.y - cy) * 0.2;
    ca += (target - ca) * 0.14; if (Math.abs(ca - target) < 0.01) ca = target;
    cur.style.opacity = ca.toFixed(2);
    cur.style.transform = `translate3d(${(cx - 220).toFixed(1)}px,${(cy - 220).toFixed(1)}px,0)`;
    cur.style.backgroundPosition = `0 0, ${(220 - cx).toFixed(1)}px ${(220 - cy).toFixed(1)}px`;
    return ca !== target || Math.abs(fx.pointer.x - cx) > 0.5 || Math.abs(fx.pointer.y - cy) > 0.5;
  });

  fx.wake();
  return () => cleanups.forEach((c) => c());
}
