import { t } from '../i18n';
import { collarControlApi, get, type AnimalDto, type CollarControlMode, type PenDto } from './api';
import { errText, toast } from './common';

export interface ManualPlaceResult {
  placed: boolean;
  lat?: number;
  lng?: number;
  source?: 'browser' | 'pen' | 'farm' | 'map';
  /** The call did nothing: the collar is already in GPS_MANUAL or a switch is in flight (the dragged point must not move). */
  skipped?: boolean;
}

// collars whose switch to GPS_MANUAL is running right now
const inflight = new Set<string>();

function penCentre(p: PenDto): [number, number] | null {
  const ring = p.polygon.coordinates[0] ?? [];
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (!pts.length) return null;
  return [pts.reduce((s, c) => s + c[0], 0) / pts.length, pts.reduce((s, c) => s + c[1], 0) / pts.length];
}

function browserPosition(): Promise<[number, number] | null> {
  if (!('geolocation' in navigator) || !navigator.geolocation) return Promise.resolve(null);
  // hard 10 s cap for the whole lookup: some browsers never call back (permission prompt left open)
  const limit = new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), 10000); });
  const lookup = new Promise<[number, number] | null>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(Number.isFinite(p.coords.latitude) && Number.isFinite(p.coords.longitude) ? [p.coords.longitude, p.coords.latitude] : null),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      );
    } catch {
      resolve(null);
    }
  });
  return Promise.race([lookup, limit]);
}

/**
 * Switches a collar into GPS_MANUAL and puts the animal's point on the map right away. The server clears the manual
 * position on entering the mode, so the point is placed after it: the browser's geolocation, else the centre of the
 * animal's pen, else of any pen, else the map centre. Throws only when the mode switch itself fails; a failed placement
 * is reported in a toast and returned as `placed: false`.
 */
export async function enterGpsManual(a: AnimalDto, opts: { pens?: PenDto[]; mapCenter?: () => [number, number] | null; alive?: () => boolean } = {}): Promise<ManualPlaceResult> {
  if (!a.collarId) return { placed: false };
  if (a.controlMode === 'GPS_MANUAL' || inflight.has(a.collarId)) return { placed: false, skipped: true };
  const collarId = a.collarId;
  inflight.add(collarId);
  try {
    return await enter(a, collarId, opts);
  } finally {
    inflight.delete(collarId);
  }
}

async function enter(a: AnimalDto, collarId: string, opts: { pens?: PenDto[]; mapCenter?: () => [number, number] | null; alive?: () => boolean }): Promise<ManualPlaceResult> {
  const gone = (): boolean => (opts.alive ? !opts.alive() : false); // the view was left meanwhile: no toasts
  const res = await collarControlApi.setMode(collarId, 'GPS_MANUAL');
  const mode: CollarControlMode = 'GPS_MANUAL';
  a.controlMode = mode;
  a.controlModeExpiresAt = res.collar.controlModeExpiresAt ?? null;
  a.positionSource = 'MANUAL';

  let point = await browserPosition();
  let source: ManualPlaceResult['source'] = 'browser';
  if (!point) {
    let pens = opts.pens;
    if (!pens) { try { pens = await get<PenDto[]>('/geofences'); } catch { pens = []; } }
    const own = pens.find((p) => p.id === a.penId);
    const ownC = own ? penCentre(own) : null;
    if (ownC) { point = ownC; source = 'pen'; } else {
      const any = pens.map(penCentre).find((c) => c != null) ?? null;
      if (any) { point = any; source = 'farm'; } else {
        const mc = opts.mapCenter?.() ?? null;
        if (mc) { point = mc; source = 'map'; }
      }
    }
  }
  if (!point) {
    if (!gone()) toast(t('a.map.manualNoPoint'));
    return { placed: false };
  }
  const [lng, lat] = point;
  try {
    await collarControlApi.setManualPosition(collarId, lat, lng);
  } catch (e) {
    if (!gone()) toast(`${t('a.map.manualPlaceFail')} ${errText(e)}`);
    return { placed: false };
  }
  a.lat = lat;
  a.lng = lng;
  a.controlMode = mode;
  a.positionSource = 'MANUAL';
  a.lastSeenAt = new Date().toISOString();
  if (!gone()) toast(t(source === 'browser' ? 'a.map.manualPlacedBrowser' : source === 'pen' ? 'a.map.manualPlacedPen' : source === 'farm' ? 'a.map.manualPlacedFarm' : 'a.map.manualPlacedMap'));
  return { placed: true, lat, lng, source };
}
