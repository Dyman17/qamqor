import { exteriorRing, polygonProblem } from '../geofences/polygon';

/** Point in a local metric frame: x = east, y = north (metres from the pen centre). */
export interface Pt {
  x: number;
  y: number;
}

/** Metres per degree of latitude; the same sphere GeofenceService uses, so distances agree. */
const M_PER_DEG = (6371000 * Math.PI) / 180;

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const len = (a: Pt): number => Math.hypot(a.x, a.y);

export function unit(a: Pt, fallback: Pt = { x: 1, y: 0 }): Pt {
  const l = len(a);
  return l < 1e-9 ? fallback : { x: a.x / l, y: a.y / l };
}

export function rotate(a: Pt, rad: number): Pt {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Moves `from` towards `to` by at most `step` metres. */
export function moveToward(from: Pt, to: Pt, step: number): Pt {
  const d = sub(to, from);
  const l = len(d);
  if (l <= step || l < 1e-9) return { ...to };
  return add(from, scale(d, step / l));
}

/**
 * Pen polygon in a local metric frame. All demo geometry (grazing, border approach, break-out,
 * manual events) is computed here; the zone itself is always decided by GeofenceService.
 */
export class PenGeometry {
  private best: Pt | null = null;

  private constructor(
    readonly lat0: number,
    readonly lng0: number,
    private readonly mx: number,
    readonly ring: Pt[],
    readonly bbox: { minX: number; maxX: number; minY: number; maxY: number },
  ) {}

  /** null when the polygon is missing or invalid (the pen is then skipped, never guessed). */
  static fromPolygon(poly: any): PenGeometry | null {
    if (!poly || polygonProblem(poly) !== null) return null;
    const r = exteriorRing(poly);
    if (!r || r.length < 4) return null;
    const open = r.slice(0, -1);
    const lats = open.map((p) => p[1]);
    const lngs = open.map((p) => p[0]);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng0 = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const mx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
    const ring = open.map((p) => ({ x: (p[0] - lng0) * mx, y: (p[1] - lat0) * M_PER_DEG }));
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    return new PenGeometry(lat0, lng0, mx, ring, {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    });
  }

  toLocal(latitude: number, longitude: number): Pt {
    return { x: (longitude - this.lng0) * this.mx, y: (latitude - this.lat0) * M_PER_DEG };
  }

  toGeo(p: Pt): { latitude: number; longitude: number } {
    return {
      latitude: Math.round((this.lat0 + p.y / M_PER_DEG) * 1e7) / 1e7,
      longitude: Math.round((this.lng0 + p.x / this.mx) * 1e7) / 1e7,
    };
  }

  /** Ray casting, any simple polygon (non-convex included). */
  inside(p: Pt): boolean {
    let inside = false;
    const r = this.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /** Nearest point of the border and its distance. */
  nearest(p: Pt): { q: Pt; dist: number } {
    let best: Pt = this.ring[0];
    let bestSq = Infinity;
    const r = this.ring;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const d = sub(b, a);
      const lenSq = d.x * d.x + d.y * d.y;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / lenSq));
      const q = { x: a.x + t * d.x, y: a.y + t * d.y };
      const dsq = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (dsq < bestSq) {
        bestSq = dsq;
        best = q;
      }
    }
    return { q: best, dist: Math.sqrt(bestSq) };
  }

  edgeDist(p: Pt): number {
    return this.nearest(p).dist;
  }

  /** Deepest interior point of a coarse grid (the "centre" used for reset and RETURN). */
  bestInterior(): Pt {
    if (this.best) return this.best;
    const { minX, maxX, minY, maxY } = this.bbox;
    const N = 24;
    let best: Pt = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    let bestD = -1;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = { x: minX + ((maxX - minX) * i) / N, y: minY + ((maxY - minY) * j) / N };
        if (!this.inside(p)) continue;
        const d = this.edgeDist(p);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    this.best = best;
    return best;
  }

  /** Random interior point whose distance to the border is within [lo, hi]; falls back to the deepest point. */
  interiorPoint(rng: () => number, lo: number, hi = Infinity, tries = 300): Pt {
    const { minX, maxX, minY, maxY } = this.bbox;
    for (let i = 0; i < tries; i++) {
      const p = { x: minX + rng() * (maxX - minX), y: minY + rng() * (maxY - minY) };
      if (!this.inside(p)) continue;
      const d = this.edgeDist(p);
      if (d >= lo && d <= hi) return p;
    }
    return this.bestInterior();
  }

  /**
   * A point `d` metres outside the border nearest to `from` (the animal's own position, inside or
   * outside), whose real distance to the border is within [lo, hi]. null when the shape allows none.
   */
  outsidePoint(from: Pt, d: number, lo: number, hi: number): Pt | null {
    const { q } = this.nearest(from);
    const base = this.inside(from) ? unit(sub(q, from)) : unit(sub(from, q));
    for (const deg of [0, 30, -30, 60, -60, 90, -90, 135, -135, 180]) {
      const c = add(q, scale(rotate(base, (deg * Math.PI) / 180), d));
      if (this.inside(c)) continue;
      const dist = this.edgeDist(c);
      if (dist >= lo && dist <= hi) return c;
    }
    return null;
  }
}

/** Rectangle of `widthM` x `heightM` metres around a centre as a closed GeoJSON Polygon. */
export function rectanglePolygon(centerLat: number, centerLng: number, widthM: number, heightM: number) {
  const dLat = heightM / 2 / M_PER_DEG;
  const dLng = widthM / 2 / (M_PER_DEG * Math.cos((centerLat * Math.PI) / 180));
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  const w = r(centerLng - dLng);
  const e = r(centerLng + dLng);
  const s = r(centerLat - dLat);
  const n = r(centerLat + dLat);
  return {
    type: 'Polygon' as const,
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}
