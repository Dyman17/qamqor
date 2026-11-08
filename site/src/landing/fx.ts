// Page effects of the v3 style (site-brief 11): one cursor source, one rAF loop, dot grid, header state,
// reveals, magnet buttons, card spotlight, sheets, count-up. No dependencies. Everything is off when motion is off.
import { isMotionOn, onMotionChange, saveDataOn } from '../motion';
import { $, $$ } from '../dom';
import { clamp } from './storyboard';

export interface Pointer { x: number; y: number; nx: number; ny: number; active: boolean; fine: boolean }
export interface Fx {
  pointer: Pointer;
  /** true during a tick when the page scrolled since the previous frame */
  scrolled: boolean;
  wake(): void;
  tick(fn: (now: number) => boolean | void): void;
  destroy(): void;
}

const smooth = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x); };

/** Wrap words of an element in inline-block spans (never letters: long RU/KK words must not break). */
export function splitWords(el: HTMLElement, stagger = 40): void {
  const words = (el.textContent ?? '').trim().split(/\s+/);
  el.textContent = '';
  words.forEach((w, i) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.style.setProperty('--wd', `${Math.min(i, 10) * stagger}ms`);
    s.textContent = w;
    el.append(s, i < words.length - 1 ? ' ' : '');
  });
  el.classList.add('split');
}

/** Count 0 -> value in 1.4 s (easeOutExpo). The DOM keeps the final number for assistive tech; a hidden copy animates. */
export function countUp(el: HTMLElement): void {
  if (el.dataset.counted || !isMotionOn()) return;
  el.dataset.counted = '1';
  const final = el.textContent ?? '';
  const n = Number(final);
  if (!Number.isFinite(n)) return;
  const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = final;
  const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true'); vis.textContent = '0';
  el.textContent = ''; el.append(sr, vis);
  const t0 = performance.now();
  const step = (now: number) => {
    const k = clamp((now - t0) / 1400);
    vis.textContent = String(Math.round(n * (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initFx(root: HTMLElement): Fx {
  const html = document.documentElement;
  const cleanups: (() => void)[] = [];
  const ticks: ((now: number) => boolean | void)[] = [];
  const fine = window.matchMedia('(pointer: fine)').matches;
  const pointer: Pointer = { x: -1e4, y: -1e4, nx: 0, ny: 0, active: false, fine };
  let raf = 0, sFlag = true, speed = 0, lastMove = 0, touch = false;
  const fx: Fx = { pointer, scrolled: true, wake, tick: (fn) => { ticks.push(fn); }, destroy: () => cleanups.forEach((c) => c()) };

  function frame(now: number): void {
    raf = 0;
    if (document.hidden) return;
    fx.scrolled = sFlag; sFlag = false;
    let more = false;
    for (const f of ticks) if (f(now)) more = true;
    if (more) raf = requestAnimationFrame(frame);
  }
  function wake(): void { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
  const on = <T extends EventTarget>(tg: T, type: string, fn: (e: any) => void, o?: AddEventListenerOptions) => {
    tg.addEventListener(type, fn, o); cleanups.push(() => tg.removeEventListener(type, fn));
  };
  cleanups.push(() => cancelAnimationFrame(raf));

  // ---- motion class: hidden initial states exist only while this is set, so no-JS and reduce always read ----
  const sync = () => html.classList.toggle('js-motion', isMotionOn());
  sync();
  cleanups.push(onMotionChange(() => { sync(); wake(); }), () => html.classList.remove('js-motion'));

  // ---- the single cursor source ----
  let magnetDirty = false;
  on(window, 'pointermove', (e: PointerEvent) => {
    const now = performance.now();
    if (lastMove) speed = (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) / Math.max(1, now - lastMove)) * 1000;
    lastMove = now;
    touch = e.pointerType === 'touch';
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.nx = (e.clientX / innerWidth) * 2 - 1; pointer.ny = (e.clientY / innerHeight) * 2 - 1;
    pointer.active = true; magnetDirty = true;
    const card = fine ? (e.target as Element).closest?.<HTMLElement>('.lit') : null;
    if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', `${e.clientX - r.left}px`); card.style.setProperty('--my', `${e.clientY - r.top}px`); }
    wake();
  }, { passive: true });
  on(window, 'pointerdown', (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touch = true; pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; wake();
  }, { passive: true });
  const off = () => { pointer.active = false; magnetDirty = true; wake(); };
  on(window, 'pointerup', (e: PointerEvent) => { if (e.pointerType === 'touch') off(); });
  on(window, 'pointercancel', off);
  on(document.documentElement, 'mouseleave', off);
  on(document, 'visibilitychange', () => { if (document.hidden) off(); else wake(); });
  on(window, 'scroll', () => { sFlag = true; wake(); }, { passive: true });
  on(window, 'resize', () => { sFlag = true; sizeCanvases(); wake(); });

  // ---- dot grid: CSS base always; canvas lights only the dots near the cursor, <= 30 fps, stops at rest ----
  const canvases = $$<HTMLCanvasElement>('.dotfield canvas', root);
  const ctxs = canvases.map((c) => c.getContext('2d')!);
  let dpr = 1, cell = 32;
  function sizeCanvases(): void {
    dpr = Math.min(1.5, devicePixelRatio || 1); cell = innerWidth < 640 ? 28 : 32;
    canvases.forEach((c, i) => {
      const r = c.parentElement!.getBoundingClientRect();
      c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
      ctxs[i].setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    box = null;
  }
  let lx = 0, ly = 0, lit = 0, R = 180, lastDraw = 0, box: [number, number, number, number] | null = null;
  const dotsOn = () => isMotionOn() && !saveDataOn() && html.dataset.light !== '1';
  function dots(now: number): boolean {
    if (!ctxs.length) return false;
    if (!dotsOn()) { if (box) { clear(); } return false; }
    if (now - lastDraw < 33) return true;
    const dt = lastDraw ? now - lastDraw : 33; lastDraw = now;
    const target = pointer.active;
    if (target && lit === 0) { lx = pointer.x; ly = pointer.y; }
    if (target) { lx += (pointer.x - lx) * 0.14; ly += (pointer.y - ly) * 0.14; lit = Math.min(1, lit + dt / 150); }
    else lit = Math.max(0, lit - dt / (touch ? 1200 : 600));
    const Rt = speed > 600 && target ? 300 : 180;
    R += (Rt - R) * (1 - Math.exp(-dt / 130));
    if (now - lastMove > 120) speed = 0;
    clear();
    if (lit > 0) {
      const x0 = lx - R, y0 = ly - R;
      box = [x0 - 4, y0 - 4, 2 * R + 8, 2 * R + 8];
      for (const g of ctxs) {
        for (let cy = Math.floor(y0 / cell) * cell + cell / 2; cy < ly + R; cy += cell) for (let cx = Math.floor(x0 / cell) * cell + cell / 2; cx < lx + R; cx += cell) {
          const d = Math.hypot(cx - lx, cy - ly);
          if (d >= R) continue;
          const k = smooth(1 - d / R) * lit;
          g.fillStyle = `rgb(${18 + 6 * k | 0},${56 + 34 * k | 0},${38 + 20 * k | 0})`; // #123826 -> #185A3A, never lighter
          g.beginPath(); g.arc(cx, cy, 1.1 + 1.1 * k, 0, 6.2832); g.fill();
        }
      }
    }
    return (target && (Math.abs(pointer.x - lx) > 0.5 || Math.abs(pointer.y - ly) > 0.5 || lit < 1 || Math.abs(Rt - R) > 0.5)) || (!target && lit > 0);
  }
  function clear(): void { if (box) { for (let i = 0; i < ctxs.length; i++) ctxs[i].clearRect(...box); box = null; } }
  sizeCanvases();
  ticks.push(dots);

  // ---- magnet buttons (fine pointer): <= 6 px towards the cursor inside 80 px ----
  const mags = fine ? $$<HTMLElement>('.btn-light, .btn-primary', root).map((el) => ({ el, x: 0, y: 0 })) : [];
  ticks.push(() => {
    if (!mags.length || !isMotionOn() || (!magnetDirty && !mags.some((m) => m.x || m.y))) return false;
    magnetDirty = false;
    let more = false;
    for (const m of mags) {
      const r = m.el.getBoundingClientRect();
      let tx = 0, ty = 0;
      if (pointer.active && r.bottom > -100 && r.top < innerHeight + 100) {
        const dx = pointer.x - (r.left + r.width / 2 - m.x), dy = pointer.y - (r.top + r.height / 2 - m.y);
        if (Math.hypot(dx, dy) < 80) { tx = clamp(dx / 80, -1, 1) * 6; ty = clamp(dy / 80, -1, 1) * 6; }
      }
      m.x += (tx - m.x) * 0.2; m.y += (ty - m.y) * 0.2;
      if (Math.abs(m.x - tx) < 0.05 && Math.abs(m.y - ty) < 0.05) { m.x = tx; m.y = ty; }
      else more = true;
      m.el.style.translate = m.x || m.y ? `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px` : '';
    }
    return more;
  });

  // ---- reveals: once per element, when it enters the window (threshold .25, bottom margin -10%) ----
  const rv = $$<HTMLElement>('.section-lead, .prob, .how-step, .animal, .stat, .adapt, .role, .app-item, .cta-actions, .biz, .safe-list li, .stages li, .road-list li, .cmp-limits li, .spec-row', root);
  rv.forEach((e) => e.classList.add('rv'));
  const titles = $$<HTMLElement>('.section .h2, #stage .hero-title, .scene-title', root);
  const split = () => titles.forEach((h) => { if (!h.querySelector('.w')) { splitWords(h, h.classList.contains('hero-title') ? 40 : 35); h.classList.add(h.classList.contains('hero-title') ? 'w-up' : 'w-blur'); if (h.dataset.shown) h.classList.add('in'); } });
  split();
  const io = new IntersectionObserver((es) => {
    let k = 0;
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      io.unobserve(el);
      el.dataset.shown = '1';
      if (el.classList.contains('rv')) el.style.setProperty('--rd', `${Math.min(k++, 5) * 80}ms`);
      el.classList.add('in');
    }
  }, { threshold: 0.25, rootMargin: '0px 0px -10% 0px' });
  [...rv, ...titles.filter((h) => !h.closest('.scene'))].forEach((e) => io.observe(e));
  cleanups.push(() => io.disconnect());
  // hero title: after the font is ready
  const hero = $('.hero-title', root);
  void (document.fonts?.ready ?? Promise.resolve()).then(() => setTimeout(() => { if (hero) { hero.dataset.shown = '1'; hero.classList.add('in'); } }, 200));

  // ---- header state, progress line, sheets (section edges rise into place) ----
  const header = $('#site-header', root);
  const prog = $('#hdr-progress', root);
  const sheets = $$<HTMLElement>('[data-sheet]', root).map((el) => ({ el, s: 48 }));
  ticks.push(() => {
    if (!fx.scrolled) return false;
    const y = scrollY, motion = isMotionOn();
    const sc = y > 24;
    if (header && (header.dataset.scrolled === '1') !== sc) header.dataset.scrolled = sc ? '1' : '0';
    if (prog && motion) prog.style.transform = `scaleX(${clamp(y / Math.max(1, html.scrollHeight - innerHeight)).toFixed(4)})`;
    for (const sh of sheets) {
      const top = sh.el.getBoundingClientRect().top - sh.s;
      sh.s = motion ? 48 * (1 - smooth((innerHeight - top) / (0.4 * innerHeight))) : 0;
      sh.el.style.setProperty('--sheet', `${sh.s.toFixed(1)}px`);
    }
    return false;
  });
  // current section in the nav (zone: 40% from the top of the window)
  const links = $$<HTMLElement>('[data-nav], .menu-link', root);
  const secIo = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => { if (a.getAttribute('href') === `#${e.target.id}`) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  ['how', 'app', 'specs', 'roadmap', 'faq'].forEach((id) => { const n = document.getElementById(id); if (n) secIo.observe(n); });
  cleanups.push(() => secIo.disconnect());
  wake();
  return fx;
}
