import { lsGet, lsSet } from './storage';

/**
 * Motion mode (site-brief 5.1, 4.5). `data-motion="on"` on <html> only when everything allows animation:
 * system setting, the manual switch (system | on | off), the performance watchdog, saveData, window height.
 */
export type MotionPref = 'system' | 'on' | 'off';
const PREF_KEY = 'qamqor.motion';
const WATCHDOG_KEY = 'qamqor.light';

let pref: MotionPref = ((): MotionPref => {
  const v = lsGet(PREF_KEY);
  return v === 'on' || v === 'off' ? v : 'system';
})();
let watchdogLight = lsGet(WATCHDOG_KEY) === '1';
const listeners = new Set<(on: boolean) => void>();

export function getMotionPref(): MotionPref { return pref; }

export function saveDataOn(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g'));
}

export function lowMemory(): boolean {
  const m = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof m === 'number' && m <= 2;
}

export function systemReduces(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isMotionOn(): boolean {
  if (pref === 'off') return false;
  if (pref === 'on') return true;
  if (systemReduces() || saveDataOn()) return false;
  if (watchdogLight) return false;
  if (window.innerHeight < 560) return false;
  return true;
}

function apply(): void {
  const on = isMotionOn();
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  listeners.forEach((l) => l(on));
}

export function setMotionPref(p: MotionPref): void {
  pref = p;
  lsSet(PREF_KEY, p);
  if (p === 'on') { watchdogLight = false; lsSet(WATCHDOG_KEY, '0'); } // a manual "on" stops the watchdog from stepping in
  apply();
}

/** Called by the performance watchdog when step 3 is reached (static posters). */
export function setWatchdogLight(): void {
  if (pref === 'on') return;
  watchdogLight = true;
  lsSet(WATCHDOG_KEY, '1');
  apply();
}
export function watchdogIsLight(): boolean { return watchdogLight && pref !== 'on'; }

export function onMotionChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function initMotion(): void {
  apply();
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', apply);
  let t: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      const now = isMotionOn();
      if ((document.documentElement.dataset.motion === 'on') !== now) apply();
    }, 120);
  });
}
