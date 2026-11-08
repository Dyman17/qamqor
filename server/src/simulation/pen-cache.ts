import { PenGeometry } from './geometry';

const CACHE = new Map<string, { sig: string; geom: PenGeometry | null }>();
const MAX = 200;

/** Geometry of a geofence row, cached by id and invalidated when its polygon changes. */
export function penGeometryOf(geofence: { id: string; polygonJson: unknown } | null | undefined): PenGeometry | null {
  if (!geofence) return null;
  const sig = JSON.stringify(geofence.polygonJson ?? null);
  const hit = CACHE.get(geofence.id);
  if (hit && hit.sig === sig) return hit.geom;
  const geom = PenGeometry.fromPolygon(geofence.polygonJson);
  if (CACHE.size >= MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(geofence.id, { sig, geom });
  return geom;
}

export function clearPenCache(): void {
  CACHE.clear();
}
