import { html, type Safe } from '../dom';
import { getLang, t } from '../i18n';
import { ApiError, simApi, type CollarResponseDto, type PenDto, type SimulationDto } from './api';

// ---- shared demo-mode state of the current farm (docs/plans/pilot-modes.md P2) ----
let sim: SimulationDto | null = null;
let simFarm: string | null = null;
const listeners = new Set<(s: SimulationDto | null) => void>();

export const getSim = (): SimulationDto | null => sim;
export const isDemoMode = (): boolean => sim != null && sim.dataMode !== 'REAL';
export function setSim(s: SimulationDto | null, farm?: string): void {
  sim = s;
  if (farm) simFarm = farm;
  listeners.forEach((l) => l(sim));
}
export function onSim(cb: (s: SimulationDto | null) => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
/** Fetch /farms/:id/simulation; errors keep the previous state (the shell banner reports the network). */
export async function refreshSim(farm: string): Promise<SimulationDto | null> {
  if (simFarm !== farm) { sim = null; simFarm = farm; }
  try { setSim(await simApi.get(farm), farm); } catch { /* keep the last known state */ }
  return sim;
}

/** The server holds a short lease while a simulation tick runs; a mode change can hit it (409). Retry once after 3 s, then explain. */
export async function retryBusy<T>(fn: () => Promise<T>, onRetry?: () => void): Promise<T> {
  const busy = (e: unknown): boolean => e instanceof ApiError && e.status === 409 && /заня|busy/i.test(e.message);
  try { return await fn(); } catch (e) {
    if (!busy(e)) throw e;
    onRetry?.();
    await new Promise((r) => setTimeout(r, 3000));
    try { return await fn(); } catch (e2) {
      if (busy(e2)) throw new ApiError(409, 'CONFLICT', t('a.demo.busy'));
      throw e2;
    }
  }
}

/** Small "Демо" tag: text + dashed outline, so the meaning is not carried by colour alone. */
export const demoTag = (isDemo: boolean | undefined): Safe => (isDemo ? html` <span class="demo-tag">${t('a.demo.tag')}</span>` : html``);

export function modeName(m: SimulationDto['dataMode']): string {
  return m === 'REAL' ? t('a.demo.m.REAL') : m === 'MANUAL' ? t('a.demo.m.MANUAL') : t('a.demo.m.AUTO');
}

// ---- collar response text: "Ответ ошейника: зона ORANGE, 3,2 м до границы, звук и вибрация" ----
export function collarResponseText(r: CollarResponseDto): string {
  const nf = new Intl.NumberFormat(getLang() === 'en' ? 'en' : 'ru', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const parts = [t('a.demo.r.zone', { zone: r.zone })];
  if (r.distanceToBorderMeters != null) parts.push(t('a.demo.r.dist', { m: nf.format(r.distanceToBorderMeters) }));
  parts.push(r.sound && r.vibrate ? t('a.demo.r.both') : r.sound ? t('a.demo.r.sound') : r.vibrate ? t('a.demo.r.vibr') : t('a.demo.r.none'));
  if (r.suppressedBy === 'SIGNAL_LIMIT') parts.push(t('a.demo.r.limit'));
  return t('a.demo.r.prefix', { text: parts.join(', ') });
}

// ---- geometry for the keyboard alternative ("step to the border / outside") ----
type Pt = [number, number]; // [lng, lat]
const M_LAT = 111_320;

/** Ray casting; ring in [lng, lat]. */
export function inside(p: Pt, ring: number[][]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Nearest boundary point of the pen to p, in metres (local equirectangular plane around p). */
function nearestOnBoundary(p: Pt, ring: number[][]): { pt: Pt; dx: number; dy: number; dist: number } | null {
  const kx = M_LAT * Math.cos((p[1] * Math.PI) / 180);
  const loc = (q: number[]): [number, number] => [(q[0] - p[0]) * kx, (q[1] - p[1]) * M_LAT];
  let best: { dx: number; dy: number; dist: number } | null = null;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = loc(ring[i]), [bx, by] = loc(ring[i + 1]);
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2));
    const dx = ax + u * vx, dy = ay + u * vy;
    const dist = Math.hypot(dx, dy);
    if (!best || dist < best.dist) best = { dx, dy, dist };
  }
  return best ? { ...best, pt: [p[0] + best.dx / kx, p[1] + best.dy / M_LAT] } : null;
}

/**
 * One keyboard step of `stepM` metres.
 * 'border': towards the nearest boundary point (stops on it). 'out': across the border and away from the pen.
 */
export function stepPoint(p: Pt, pen: PenDto, dir: 'border' | 'out', stepM = 10): Pt | null {
  const ring = pen.polygon.coordinates[0];
  if (!ring || ring.length < 4) return null;
  const near = nearestOnBoundary(p, ring);
  if (!near) return null;
  const kx = M_LAT * Math.cos((p[1] * Math.PI) / 180);
  const isIn = inside(p, ring);
  // unit vector from p to the nearest boundary point; outwards is "towards it" when inside and "away from it" when outside
  const d = Math.max(near.dist, 1e-6);
  const ux = near.dx / d, uy = near.dy / d;
  let mx: number, my: number;
  if (dir === 'border') {
    const m = Math.min(stepM, near.dist);
    mx = ux * m; my = uy * m;
  } else {
    const s = isIn ? 1 : -1;
    mx = ux * s * stepM; my = uy * s * stepM;
  }
  return [p[0] + mx / kx, p[1] + my / M_LAT];
}

export function ringCentroid(pen: PenDto): Pt {
  const pts = (pen.polygon.coordinates[0] ?? []).slice(0, -1);
  const n = Math.max(1, pts.length);
  return [pts.reduce((s, c) => s + c[0], 0) / n, pts.reduce((s, c) => s + c[1], 0) / n];
}
