import { t } from '../i18n';
import { collarControlApi, get, type AnimalDto, type CollarControlMode, type PenDto } from './api';
import { errText, toast } from './common';

export interface ManualPlaceResult {
  placed: boolean;
  lat?: number;
  lng?: number;
  source?: 'browser' | 'pen' | 'farm' | 'map';
}

function penCentre(p: PenDto): [number, number] | null {
  const ring = p.polygon.coordinates[0] ?? [];
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (!pts.length) return null;
  return [pts.reduce((s, c) => s + c[0], 0) / pts.length, pts.reduce((s, c) => s + c[1], 0) / pts.length];
}

function browserPosition(): Promise<[number, number] | null> {
  if (!('geolocation' in navigator) || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
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
}

/**
 * Switches a collar into GPS_MANUAL and puts the animal's point on the map right away. The server clears the manual
 * position on entering the mode, so the point is placed after it: the browser's geolocation, else the centre of the
 * animal's pen, else of any pen, else the map centre. Throws only when the mode switch itself fails; a failed placement
 * is reported in a toast and returned as `placed: false`.
 */
export async function enterGpsManual(a: AnimalDto, opts: { pens?: PenDto[]; mapCenter?: () => [number, number] | null } = {}): Promise<ManualPlaceResult> {
  if (!a.collarId) return { placed: false };
  const res = await collarControlApi.setMode(a.collarId, 'GPS_MANUAL');
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
    toast(t('a.map.manualNoPoint'));
    return { placed: false };
  }
  const [lng, lat] = point;
  try {
    await collarControlApi.setManualPosition(a.collarId, lat, lng);
  } catch (e) {
    toast(`${t('a.map.manualPlaceFail')} ${errText(e)}`);
    return { placed: false };
  }
  a.lat = lat;
  a.lng = lng;
  a.controlMode = mode;
  a.positionSource = 'MANUAL';
  a.lastSeenAt = new Date().toISOString();
  toast(t(source === 'browser' ? 'a.map.manualPlacedBrowser' : source === 'pen' ? 'a.map.manualPlacedPen' : source === 'farm' ? 'a.map.manualPlacedFarm' : 'a.map.manualPlacedMap'));
  return { placed: true, lat, lng, source };
}
