import { registerDecorator, ValidationOptions } from 'class-validator';

export const MIN_VERTICES = 3;
export const MAX_VERTICES = 500;

type Pt = [number, number]; // [lng, lat]

/** Extracts the exterior ring of a GeoJSON Polygon, or null when the shape is not usable at all. */
export function exteriorRing(poly: any): Pt[] | null {
  const coords = poly?.geometry?.coordinates ?? poly?.coordinates;
  if (!Array.isArray(coords) || !Array.isArray(coords[0])) return null;
  const ring = coords[0];
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  }
  return ring as Pt[];
}

function cross(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  );
}

/** True when segments ab and cd share at least one point. */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(a, b, c)) return true;
  if (d2 === 0 && onSegment(a, b, d)) return true;
  if (d3 === 0 && onSegment(c, d, a)) return true;
  if (d4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** Signed shoelace area in square degrees (only used to detect zero area). */
function shoelace(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

/**
 * Returns a human readable problem, or null when the polygon is valid:
 * GeoJSON Polygon with a single closed ring, 3-500 distinct vertices, coordinates in range,
 * no self-intersections, non-zero area.
 */
export function polygonProblem(poly: any): string | null {
  if (!poly || typeof poly !== 'object' || poly.type !== 'Polygon') return 'Ожидается GeoJSON Polygon';
  if (!Array.isArray(poly.coordinates) || poly.coordinates.length !== 1) {
    return 'Допускается одно внешнее кольцо без отверстий';
  }
  const ring = exteriorRing(poly);
  if (!ring) return 'Некорректные координаты вершин';
  if (ring.length < MIN_VERTICES + 1) return `Нужно не менее ${MIN_VERTICES} вершин`;
  if (ring.length - 1 > MAX_VERTICES) return `Не более ${MAX_VERTICES} вершин`;
  for (const [lng, lat] of ring) {
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return 'Координаты вне допустимого диапазона';
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return 'Кольцо должно быть замкнуто';

  const open = ring.slice(0, -1);
  const distinct = new Set(open.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < MIN_VERTICES) return `Нужно не менее ${MIN_VERTICES} различных вершин`;
  if (distinct.size !== open.length) return 'Вершины повторяются';

  if (shoelace(ring) === 0) return 'Нулевая площадь';

  const n = open.length;
  for (let i = 0; i < n; i++) {
    const a = open[i];
    const b = open[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // adjacent segments share an endpoint by construction
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a, b, open[j], open[(j + 1) % n])) return 'Граница пересекает сама себя';
    }
  }
  return null;
}

export const isValidPolygon = (poly: any): boolean => polygonProblem(poly) === null;

/** Approximate area in hectares (equirectangular projection around the centroid latitude). */
export function polygonAreaHa(poly: any): number {
  const ring = exteriorRing(poly);
  if (!ring || ring.length < 4) return 0;
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const mx = 111_320 * Math.cos(lat0);
  const my = 110_540;
  const pts = ring.map((p) => [p[0] * mx, p[1] * my]);
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.round((Math.abs(s) / 2 / 10_000) * 100) / 100;
}

/** class-validator decorator: GeoJSON Polygon that passes `polygonProblem`. */
export function IsGeoJsonPolygon(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isGeoJsonPolygon',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (v: unknown) => polygonProblem(v) === null,
        defaultMessage: (args) => `${args?.property}: ${polygonProblem(args?.value) ?? 'некорректный полигон'}`,
      },
    });
}
