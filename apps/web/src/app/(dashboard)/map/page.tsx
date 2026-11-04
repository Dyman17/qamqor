'use client';

import React, { useEffect, useRef, useState, useMemo, Suspense } from 'react';
import { ApiClient } from '../../../lib/api';
import {
  Radio,
  Battery,
  AlertTriangle,
  PenTool,
  X,
  Undo2,
  Trash2,
  Volume2,
  Layers,
  Signal,
  Zap,
  Activity,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Ruler,
  Compass,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type VirtualZone = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE';

interface DeviceStatus {
  deviceId: string;
  isOnline: boolean;
  status: 'ONLINE' | 'OFFLINE';
  secondsSinceLastPing: number | null;
  lastHeartbeatAt: string | null;
  battery: number | null;
  signal: number | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  gpsAccuracy?: number | null;
  buzzer: boolean;
  sound?: boolean;
  vibrate?: boolean;
  shock?: boolean;
  zone?: VirtualZone;
  distanceToBorderMeters?: number | null;
  toneFrequencyHz?: number | null;
}

// Default pasture polygon around Aktau, Mangystau pasture testing grounds
const DEFAULT_PASTURE_COORDS: number[][] = [
  [51.1510, 43.6550],
  [51.1640, 43.6550],
  [51.1640, 43.6450],
  [51.1510, 43.6450],
  [51.1510, 43.6550],
];

// -------------------------------------------------------------
// SPATIAL GEOMETRY HELPERS
// -------------------------------------------------------------

function pointToSegmentDistanceMeters(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  latRef: number,
): number {
  const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
  const ky = 110574;
  const pX = px * kx;
  const pY = py * ky;
  const aX = ax * kx;
  const aY = ay * ky;
  const bX = bx * kx;
  const bY = by * ky;

  const dx = bX - aX;
  const dy = bY - aY;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(pX - aX, pY - aY);
  }

  const t = Math.max(0, Math.min(1, ((pX - aX) * dx + (pY - aY) * dy) / lenSq));
  const projX = aX + t * dx;
  const projY = aY + t * dy;
  return Math.hypot(pX - projX, pY - projY);
}

function isPointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function computeDistanceToBorder(
  lng: number,
  lat: number,
  ring: number[][],
): { inside: boolean; distance: number } {
  if (!ring || ring.length < 3) return { inside: true, distance: 999 };
  const inside = isPointInPolygon(lng, lat, ring);
  let minDist = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = pointToSegmentDistanceMeters(
      lng,
      lat,
      ring[i][0],
      ring[i][1],
      ring[i + 1][0],
      ring[i + 1][1],
      lat,
    );
    if (d < minDist) minDist = d;
  }
  return { inside, distance: inside ? minDist : -minDist };
}

/**
 * Computes an inward offset polygon ring in geographic coordinates.
 * distanceMeters: buffer depth in meters (e.g. 5m for critical, 20m for warning)
 */
function computeInsetRing(ring: number[][], distanceMeters: number): number[][] {
  if (!ring || ring.length < 4) return ring;

  const pts = ring.slice(0, ring.length - 1);
  const n = pts.length;
  if (n < 3) return ring;

  let cLng = 0;
  let cLat = 0;
  for (const p of pts) {
    cLng += p[0];
    cLat += p[1];
  }
  cLng /= n;
  cLat /= n;

  const latRad = (cLat * Math.PI) / 180;
  const kx = 111320 * Math.cos(latRad);
  const ky = 110574;

  const localPts = pts.map(([lng, lat]) => ({
    x: (lng - cLng) * kx,
    y: (lat - cLat) * ky,
  }));

  let area = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    area += localPts[i].x * localPts[next].y - localPts[next].x * localPts[i].y;
  }
  const isCCW = area > 0;

  let maxRadius = 0;
  for (const p of localPts) {
    const r = Math.hypot(p.x, p.y);
    if (r > maxRadius) maxRadius = r;
  }

  // Gracefully scale towards centroid if distance is large compared to polygon
  if (distanceMeters >= maxRadius * 0.75) {
    const scale = Math.max(0.08, 1 - distanceMeters / maxRadius);
    const scaled = localPts.map((p) => [
      cLng + (p.x * scale) / kx,
      cLat + (p.y * scale) / ky,
    ]);
    return [...scaled, scaled[0]];
  }

  const result: number[][] = [];

  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;

    const d1x = localPts[i].x - localPts[prev].x;
    const d1y = localPts[i].y - localPts[prev].y;
    const len1 = Math.hypot(d1x, d1y) || 1;
    const u1x = d1x / len1;
    const u1y = d1y / len1;

    const n1x = isCCW ? -u1y : u1y;
    const n1y = isCCW ? u1x : -u1x;

    const d2x = localPts[next].x - localPts[i].x;
    const d2y = localPts[next].y - localPts[i].y;
    const len2 = Math.hypot(d2x, d2y) || 1;
    const u2x = d2x / len2;
    const u2y = d2y / len2;

    const n2x = isCCW ? -u2y : u2y;
    const n2y = isCCW ? u2x : -u2x;

    let bx = n1x + n2x;
    let by = n1y + n2y;
    const blen = Math.hypot(bx, by);

    let offsetDist = distanceMeters;
    if (blen > 0.001) {
      bx /= blen;
      by /= blen;
      const dot = n1x * bx + n1y * by;
      const miter = dot > 0.25 ? distanceMeters / dot : distanceMeters * 2;
      offsetDist = Math.min(miter, distanceMeters * 2.2);
    } else {
      bx = n1x;
      by = n1y;
    }

    const newX = localPts[i].x + bx * offsetDist;
    const newY = localPts[i].y + by * offsetDist;

    result.push([cLng + newX / kx, cLat + newY / ky]);
  }

  return [...result, result[0]];
}

// -------------------------------------------------------------
// MAIN COMPONENT
// -------------------------------------------------------------

function LiveMapContent() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [device, setDevice] = useState<DeviceStatus>({
    deviceId: 'QAM-0001',
    isOnline: true,
    status: 'ONLINE',
    secondsSinceLastPing: 4,
    lastHeartbeatAt: new Date().toISOString(),
    battery: 92,
    signal: -68,
    lastLatitude: 43.6501,
    lastLongitude: 51.1572,
    gpsAccuracy: 2.8,
    buzzer: false,
    sound: false,
    vibrate: false,
    shock: false,
    zone: 'GREEN',
    distanceToBorderMeters: 52,
    toneFrequencyHz: 0,
  });

  const [geofences, setGeofences] = useState<any[]>([]);
  const [triggerLoading, setTriggerLoading] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('Пастбище Актау-1');
  const [newGeofenceDesc, setNewGeofenceDesc] = useState('Основной выпас КРС');
  const [savingGeofence, setSavingGeofence] = useState(false);

  // Determine active pasture ring (from DB or default)
  const activePastureRing = useMemo<number[][]>(() => {
    if (geofences.length > 0) {
      for (const gf of geofences) {
        let geojson: any = null;
        if (typeof gf.polygonJson === 'string') {
          try {
            geojson = JSON.parse(gf.polygonJson);
          } catch {}
        } else if (typeof gf.polygonJson === 'object') {
          geojson = gf.polygonJson;
        }
        if (geojson?.geometry?.coordinates?.[0]) {
          return geojson.geometry.coordinates[0];
        }
        if (geojson?.coordinates?.[0]) {
          return geojson.coordinates[0];
        }
      }
    }
    return DEFAULT_PASTURE_COORDS;
  }, [geofences]);

  // Compute live distance and zone based on collar location
  const spatialTelemetry = useMemo(() => {
    const lat = device.lastLatitude ?? 43.6501;
    const lng = device.lastLongitude ?? 51.1572;
    const { inside, distance } = computeDistanceToBorder(lng, lat, activePastureRing);

    // If manual trigger override active, prefer explicit state
    if (device.zone) {
      return {
        inside: device.zone === 'GREEN' || device.zone === 'YELLOW' || device.zone === 'ORANGE',
        distance: device.distanceToBorderMeters ?? (inside ? distance : -distance),
        zone: device.zone,
        toneFrequencyHz:
          device.toneFrequencyHz ??
          (device.zone === 'YELLOW'
            ? 1100
            : device.zone === 'ORANGE' || device.zone === 'RED'
              ? 1400
              : 0),
      };
    }

    let zone: VirtualZone = 'GREEN';
    let toneFreq = 0;

    if (inside) {
      if (distance > 20) {
        zone = 'GREEN';
        toneFreq = 0;
      } else if (distance > 5) {
        zone = 'YELLOW';
        // Proportional acoustic scaling 800 - 1400 Hz
        toneFreq = Math.round(1400 - ((distance - 5) / 15) * 600);
      } else {
        zone = 'ORANGE';
        toneFreq = 1400;
      }
    } else {
      if (Math.abs(distance) < 35) {
        zone = 'RED';
        toneFreq = 1400;
      } else {
        zone = 'ESCAPE';
        toneFreq = 1400;
      }
    }

    return { inside, distance, zone, toneFrequencyHz: toneFreq };
  }, [
    device.lastLatitude,
    device.lastLongitude,
    device.zone,
    device.distanceToBorderMeters,
    device.toneFrequencyHz,
    activePastureRing,
  ]);

  const currentZone = spatialTelemetry.zone;
  const currentDistance = spatialTelemetry.distance;
  const currentToneFreq = spatialTelemetry.toneFrequencyHz;

  // 1. Fetch real hardware device status & geofences
  const fetchLiveStatus = async () => {
    try {
      const [devStatus, geofencesData] = await Promise.all([
        ApiClient.getDeviceStatus('QAM-0001').catch(() => null),
        ApiClient.listGeofences().catch(() => []),
      ]);

      if (devStatus) {
        setDevice((prev) => ({
          ...prev,
          ...devStatus,
          lastLatitude: devStatus.lastLatitude ?? prev.lastLatitude ?? 43.6501,
          lastLongitude: devStatus.lastLongitude ?? prev.lastLongitude ?? 51.1572,
        }));
      }
      setGeofences(geofencesData || []);
    } catch (e) {
      console.error('Fetch error:', e);
    }
  };

  useEffect(() => {
    fetchLiveStatus();
    const timer = setInterval(fetchLiveStatus, 2500);
    return () => clearInterval(timer);
  }, []);

  // 2. Hardware Trigger Control
  const handleToggleTrigger = async (type: 'sound' | 'vibrate' | 'shock' | 'reset') => {
    setTriggerLoading(true);
    try {
      if (type === 'reset') {
        await ApiClient.setDeviceTrigger({
          deviceId: device.deviceId,
          reset: true,
          sound: false,
          vibrate: false,
          shock: false,
          zone: 'GREEN',
          distanceToBorderMeters: 55,
          toneFrequencyHz: 0,
        });
        setDevice((prev) => ({
          ...prev,
          sound: false,
          vibrate: false,
          shock: false,
          buzzer: false,
          zone: 'GREEN',
          distanceToBorderMeters: 55,
          toneFrequencyHz: 0,
          lastLatitude: 43.6501,
          lastLongitude: 51.1572,
        }));
        setFeedbackMessage('Сброс всех триггеров выполнен. Ошейник в штатном режиме.');
      } else {
        const next = !Boolean(device[type]);
        const newPayload = {
          deviceId: device.deviceId,
          sound: type === 'sound' ? next : Boolean(device.sound),
          vibrate: type === 'vibrate' ? next : Boolean(device.vibrate),
          shock: type === 'shock' ? next : Boolean(device.shock),
        };
        await ApiClient.setDeviceTrigger(newPayload);
        setDevice((prev) => ({
          ...prev,
          [type]: next,
          buzzer: newPayload.sound,
        }));

        const labels: Record<string, string> = {
          sound: 'Сирена 0.5W MAX98357',
          vibrate: 'Вибромотор (GPIO 27)',
          shock: 'Импульс шокера 400кВ (150 мс)',
        };
        setFeedbackMessage(
          next
            ? `${labels[type]} активирован на устройстве`
            : `${labels[type]} деактивирован`,
        );
      }
      setTimeout(() => setFeedbackMessage(null), 4000);
      fetchLiveStatus();
    } catch (err: any) {
      console.error('Trigger error:', err);
      setFeedbackMessage('Ошибка связи с сервером управления');
      setTimeout(() => setFeedbackMessage(null), 4000);
    } finally {
      setTriggerLoading(false);
    }
  };

  // Quick Zone Simulator / Field Steering Test
  const handleSimulateZone = async (targetZone: VirtualZone) => {
    setTriggerLoading(true);
    try {
      let lat = 43.6501;
      let lng = 51.1572;
      let sound = false;
      let vibrate = false;
      let shock = false;
      let dist = 50;
      let freq = 0;

      switch (targetZone) {
        case 'GREEN':
          lat = 43.6501;
          lng = 51.1572;
          dist = 52;
          freq = 0;
          break;
        case 'YELLOW':
          lat = 43.6538;
          lng = 51.1572;
          dist = 13;
          freq = 1080;
          sound = true;
          break;
        case 'ORANGE':
          lat = 43.6547;
          lng = 51.1572;
          dist = 3.2;
          freq = 1400;
          sound = true;
          vibrate = true;
          break;
        case 'RED':
          lat = 43.6558;
          lng = 51.1572;
          dist = -9.5;
          freq = 1400;
          sound = true;
          vibrate = true;
          shock = true;
          break;
        case 'ESCAPE':
          lat = 43.6590;
          lng = 51.1572;
          dist = -48;
          freq = 1400;
          sound = true;
          vibrate = true;
          shock = false; // Inhibit shock in panic mode
          break;
      }

      await ApiClient.setDeviceTrigger({
        deviceId: device.deviceId,
        sound,
        vibrate,
        shock,
        zone: targetZone,
        distanceToBorderMeters: dist,
        toneFrequencyHz: freq,
      });

      setDevice((prev) => ({
        ...prev,
        lastLatitude: lat,
        lastLongitude: lng,
        sound,
        vibrate,
        shock,
        buzzer: sound,
        zone: targetZone,
        distanceToBorderMeters: dist,
        toneFrequencyHz: freq,
      }));

      const zoneNames: Record<VirtualZone, string> = {
        GREEN: 'Внутри пастбища (безопасно)',
        YELLOW: 'Предупреждение: звук (800-1400 Гц)',
        ORANGE: 'Предграничная зона: звук + вибро',
        RED: 'Нарушение: 400кВ импульс',
        ESCAPE: 'Сорвался в бегство: анти-паника',
      };
      setFeedbackMessage(`Тест зоны: ${zoneNames[targetZone]}`);
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (e) {
      console.error('Zone switch failed:', e);
    } finally {
      setTriggerLoading(false);
    }
  };

  // 3. Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    let isMounted = true;

    async function initMap() {
      const maplibregl = (await import('maplibre-gl')).default;
      if (!isMounted || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [
                'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
              ],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap Contributors',
            },
          },
          layers: [
            {
              id: 'osm-tiles',
              type: 'raster',
              source: 'osm',
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        center: [51.1572, 43.6501],
        zoom: 14.2,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

      map.on('click', (e) => {
        const { lng, lat } = e.lngLat;
        if (isDrawing) {
          setDrawPoints((prev) => [...prev, [lng, lat]]);
        }
      });

      mapInstanceRef.current = map;
    }

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isDrawing]);

  // 4. Render Multi-Zone Virtual Fence Layers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderMultiZones = () => {
      const activeFences =
        geofences.length > 0
          ? geofences
          : [
              {
                id: 'default-active-pasture',
                name: 'Контур пастбища Актау',
                polygonJson: {
                  type: 'Feature',
                  geometry: {
                    type: 'Polygon',
                    coordinates: [DEFAULT_PASTURE_COORDS],
                  },
                },
              },
            ];

      activeFences.forEach((gf) => {
        let geojson: any = null;
        if (typeof gf.polygonJson === 'string') {
          try {
            geojson = JSON.parse(gf.polygonJson);
          } catch {}
        } else if (typeof gf.polygonJson === 'object') {
          geojson = gf.polygonJson;
        }

        const ringCoords =
          geojson?.geometry?.coordinates?.[0] || geojson?.coordinates?.[0];
        if (!ringCoords || ringCoords.length < 3) return;

        // Multi-zone buffered geometries
        const boundaryRing = ringCoords;
        const criticalRing = computeInsetRing(ringCoords, 5);  // 5m buffer
        const warningRing = computeInsetRing(ringCoords, 20);  // 20m buffer

        const safePastureGeoJson: any = {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [warningRing] },
        };

        const warningBufferGeoJson: any = {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [criticalRing] },
        };

        const boundaryGeoJson: any = {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [boundaryRing] },
        };

        const criticalLineGeoJson: any = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: criticalRing },
        };

        const warningLineGeoJson: any = {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: warningRing },
        };

        // Source IDs
        const srcBoundary = `src-gf-bound-${gf.id}`;
        const srcWarn = `src-gf-warn-${gf.id}`;
        const srcSafe = `src-gf-safe-${gf.id}`;
        const srcCritLine = `src-gf-crit-line-${gf.id}`;
        const srcWarnLine = `src-gf-warn-line-${gf.id}`;

        // Update or Add Sources
        if (map.getSource(srcBoundary)) {
          map.getSource(srcBoundary).setData(boundaryGeoJson);
        } else {
          map.addSource(srcBoundary, { type: 'geojson', data: boundaryGeoJson });
        }

        if (map.getSource(srcWarn)) {
          map.getSource(srcWarn).setData(warningBufferGeoJson);
        } else {
          map.addSource(srcWarn, { type: 'geojson', data: warningBufferGeoJson });
        }

        if (map.getSource(srcSafe)) {
          map.getSource(srcSafe).setData(safePastureGeoJson);
        } else {
          map.addSource(srcSafe, { type: 'geojson', data: safePastureGeoJson });
        }

        if (map.getSource(srcCritLine)) {
          map.getSource(srcCritLine).setData(criticalLineGeoJson);
        } else {
          map.addSource(srcCritLine, { type: 'geojson', data: criticalLineGeoJson });
        }

        if (map.getSource(srcWarnLine)) {
          map.getSource(srcWarnLine).setData(warningLineGeoJson);
        } else {
          map.addSource(srcWarnLine, { type: 'geojson', data: warningLineGeoJson });
        }

        // Layer 1: Warning buffer yellow fill (between 5m and 20m)
        const lyrWarnFill = `lyr-warn-fill-${gf.id}`;
        if (!map.getLayer(lyrWarnFill)) {
          map.addLayer({
            id: lyrWarnFill,
            type: 'fill',
            source: srcWarn,
            paint: {
              'fill-color': '#eab308',
              'fill-opacity': 0.18,
            },
          });
        }

        // Layer 2: Safe pasture green fill (>20m inside)
        const lyrSafeFill = `lyr-safe-fill-${gf.id}`;
        if (!map.getLayer(lyrSafeFill)) {
          map.addLayer({
            id: lyrSafeFill,
            type: 'fill',
            source: srcSafe,
            paint: {
              'fill-color': '#10b981',
              'fill-opacity': 0.22,
            },
          });
        }

        // Layer 3: Critical buffer inner ring (5m line, dashed orange)
        const lyrCritLine = `lyr-crit-line-${gf.id}`;
        if (!map.getLayer(lyrCritLine)) {
          map.addLayer({
            id: lyrCritLine,
            type: 'line',
            source: srcCritLine,
            paint: {
              'line-color': '#f97316',
              'line-width': 1.8,
              'line-dasharray': [3, 2],
            },
          });
        }

        // Layer 4: Warning buffer inner ring (20m line, dashed yellow)
        const lyrWarnLine = `lyr-warn-line-${gf.id}`;
        if (!map.getLayer(lyrWarnLine)) {
          map.addLayer({
            id: lyrWarnLine,
            type: 'line',
            source: srcWarnLine,
            paint: {
              'line-color': '#eab308',
              'line-width': 1.8,
              'line-dasharray': [4, 2],
            },
          });
        }

        // Layer 5: Boundary border line (Solid Red)
        const lyrBorderLine = `lyr-border-line-${gf.id}`;
        if (!map.getLayer(lyrBorderLine)) {
          map.addLayer({
            id: lyrBorderLine,
            type: 'line',
            source: srcBoundary,
            paint: {
              'line-color': '#ef4444',
              'line-width': 3,
            },
          });
        }
      });
    };

    if (map.isStyleLoaded()) {
      renderMultiZones();
    } else {
      map.once('load', renderMultiZones);
    }
  }, [geofences]);

  // 5. Render Drawing Dynamic Polygon
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const sourceId = 'source-drawing';
    const fillLayerId = 'layer-drawing-fill';
    const lineLayerId = 'layer-drawing-line';

    const coords = drawPoints.length >= 3 ? [...drawPoints, drawPoints[0]] : drawPoints;
    const geojson: any = {
      type: 'Feature',
      geometry: {
        type: drawPoints.length >= 3 ? 'Polygon' : 'LineString',
        coordinates: drawPoints.length >= 3 ? [coords] : coords,
      },
    };

    if (map.isStyleLoaded()) {
      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson);
      } else if (drawPoints.length > 0) {
        map.addSource(sourceId, { type: 'geojson', data: geojson });
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: { 'fill-color': '#eab308', 'fill-opacity': 0.2 },
        });
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#eab308', 'line-width': 2.5, 'line-dasharray': [2, 2] },
        });
      }
    }
  }, [drawPoints]);

  // 6. Render Device Livestock Marker with Zone Ring Halo
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const lat = device.lastLatitude ?? 43.6501;
    const lng = device.lastLongitude ?? 51.1572;

    import('maplibre-gl').then((maplibreglModule) => {
      const maplibregl = maplibreglModule.default;

      let markerBg = 'bg-emerald-600 ring-emerald-400/50';
      let haloColor = 'border-emerald-500/30';
      let badgeLabel = 'В НОРМЕ';

      if (currentZone === 'YELLOW') {
        markerBg = 'bg-amber-600 ring-amber-400 animate-pulse';
        haloColor = 'border-amber-500/60';
        badgeLabel = 'ЗВУК 0.5W';
      } else if (currentZone === 'ORANGE') {
        markerBg = 'bg-orange-600 ring-orange-400 animate-pulse';
        haloColor = 'border-orange-500/70';
        badgeLabel = 'ВИБРО + ЗВУК';
      } else if (currentZone === 'RED') {
        markerBg = 'bg-rose-600 ring-rose-400 animate-pulse shadow-rose-950/80';
        haloColor = 'border-rose-500/90';
        badgeLabel = 'ШОКЕР 400кВ';
      } else if (currentZone === 'ESCAPE') {
        markerBg = 'bg-red-700 ring-red-500 animate-bounce shadow-red-950/90';
        haloColor = 'border-red-500';
        badgeLabel = 'АНТИ-ПАНИКА';
      }

      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
        const el = markerRef.current.getElement();
        if (el) {
          el.innerHTML = `
            <div class="relative flex items-center justify-center cursor-pointer group">
              <div class="absolute -inset-2 rounded-full border-2 ${haloColor} animate-ping opacity-60 pointer-events-none"></div>
              <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-mono font-bold text-xs shadow-xl ring-4 ${markerBg} transition-transform group-hover:scale-110">
                WROV
              </div>
              <div class="absolute -bottom-6 whitespace-nowrap px-2 py-0.5 rounded bg-zinc-900/95 text-[10px] text-zinc-100 border border-zinc-700 font-mono shadow-md flex items-center gap-1">
                <span class="font-bold">${device.deviceId}</span>
                <span class="text-zinc-400">•</span>
                <span class="text-[9px] uppercase tracking-wider">${badgeLabel}</span>
              </div>
            </div>
          `;
        }
      } else {
        const el = document.createElement('div');
        el.className = 'custom-device-marker';
        el.innerHTML = `
          <div class="relative flex items-center justify-center cursor-pointer group">
            <div class="absolute -inset-2 rounded-full border-2 ${haloColor} animate-ping opacity-60 pointer-events-none"></div>
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-mono font-bold text-xs shadow-xl ring-4 ${markerBg} transition-transform group-hover:scale-110">
              WROV
            </div>
            <div class="absolute -bottom-6 whitespace-nowrap px-2 py-0.5 rounded bg-zinc-900/95 text-[10px] text-zinc-100 border border-zinc-700 font-mono shadow-md flex items-center gap-1">
              <span class="font-bold">${device.deviceId}</span>
              <span class="text-zinc-400">•</span>
              <span class="text-[9px] uppercase tracking-wider">${badgeLabel}</span>
            </div>
          </div>
        `;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);

        markerRef.current = marker;
      }
    });
  }, [
    device.lastLatitude,
    device.lastLongitude,
    device.deviceId,
    currentZone,
  ]);

  // 7. Save Geofence Handler
  const handleSaveGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drawPoints.length < 3) return;

    setSavingGeofence(true);
    try {
      const closedPoints = [...drawPoints, drawPoints[0]];
      const polygonGeoJson = {
        type: 'Feature',
        properties: { name: newGeofenceName },
        geometry: {
          type: 'Polygon',
          coordinates: [closedPoints],
        },
      };

      await ApiClient.createGeofence({
        name: newGeofenceName,
        description: newGeofenceDesc,
        polygonJson: polygonGeoJson,
      });

      setIsSaveModalOpen(false);
      setIsDrawing(false);
      setDrawPoints([]);
      fetchLiveStatus();
      setFeedbackMessage(`Геозона «${newGeofenceName}» успешно сохранена`);
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (err) {
      console.error('Failed to create geofence:', err);
    } finally {
      setSavingGeofence(false);
    }
  };

  // Status Badge UI configuration
  const zoneConfig = useMemo(() => {
    switch (currentZone) {
      case 'GREEN':
        return {
          title: 'ВНУТРИ ПАСТБИЩА (БЕЗОПАСНО)',
          subtitle: 'Удаление > 20 м от границы • Исполнители в режиме покоя',
          badgeClass: 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300',
          dotClass: 'bg-emerald-400',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />,
        };
      case 'YELLOW':
        return {
          title: `ПРЕДУПРЕЖДЕНИЕ: ЗВУК (${currentToneFreq > 0 ? `${currentToneFreq} Гц` : '800-1400 Гц'})`,
          subtitle: 'Буферная зона 5-20 м • Нарастающая частота аудиосирены',
          badgeClass: 'bg-amber-950/90 border-amber-500/60 text-amber-300 ring-1 ring-amber-500/30',
          dotClass: 'bg-amber-400 animate-pulse',
          icon: <Volume2 className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />,
        };
      case 'ORANGE':
        return {
          title: 'ПРЕДГРАНИЧНАЯ ЗОНА: ЗВУК + ВИБРО',
          subtitle: 'Критический буфер 0-5 м • Тактильный виброимпульс (GPIO 27)',
          badgeClass: 'bg-orange-950/90 border-orange-500/70 text-orange-200 ring-1 ring-orange-500/40',
          dotClass: 'bg-orange-400 animate-pulse',
          icon: <Activity className="w-5 h-5 text-orange-400 shrink-0 animate-pulse" />,
        };
      case 'RED':
        return {
          title: 'НАРУШЕНИЕ: 400кВ ИМПУЛЬС',
          subtitle: 'Пересечение границы забора • Разряд 400кВ (150 мс)',
          badgeClass: 'bg-rose-950 border-rose-500 text-rose-100 ring-2 ring-rose-500/60 animate-pulse',
          dotClass: 'bg-rose-400 animate-ping',
          icon: <Zap className="w-5 h-5 text-rose-400 fill-rose-400 shrink-0" />,
        };
      case 'ESCAPE':
        return {
          title: 'СОРВАЛСЯ В БЕГСТВО: АНТИ-ПАНИКА',
          subtitle: 'Животное в паническом бегстве • Шокер отключен для защиты скота',
          badgeClass: 'bg-red-950 border-red-500 text-red-100 ring-2 ring-red-500 shadow-lg shadow-red-950',
          dotClass: 'bg-red-500 animate-ping',
          icon: <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />,
        };
    }
  }, [currentZone, currentToneFreq]);

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans text-xs">
      {/* 1. TOP BAR: DEVICE STATUS, ZONE BANNER & DIRECT STEERING CONTROLS */}
      <header className="h-16 px-4 md:px-6 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0 z-20">
        {/* Device identifier & online heartbeat */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-zinc-200 text-sm tracking-wider font-mono">
              {device.deviceId}
            </span>
          </div>

          {device.isOnline ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              В СЕТИ ({device.secondsSinceLastPing != null ? `${device.secondsSinceLastPing}с` : 'online'})
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-mono font-medium">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              НЕТ СВЯЗИ
            </span>
          )}
        </div>

        {/* Center Zone Telemetry Pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded border font-mono transition-all max-w-md truncate shadow-sm">
          <div className={`flex items-center gap-2 px-3 py-1 rounded border ${zoneConfig.badgeClass}`}>
            <span className={`w-2 h-2 rounded-full ${zoneConfig.dotClass}`} />
            <span className="font-bold text-xs tracking-wide">{zoneConfig.title}</span>
          </div>
        </div>

        {/* Action Buttons with Lucide Icons exclusively */}
        <div className="flex items-center gap-2 shrink-0 overflow-x-auto">
          {/* Audio siren toggle */}
          <button
            onClick={() => handleToggleTrigger('sound')}
            disabled={triggerLoading}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-xs font-bold transition-all border ${
              device.sound
                ? 'bg-amber-600 border-amber-400 text-white animate-pulse'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
            }`}
            title="Тест сирены I2S MAX98357"
          >
            <Volume2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Звук 0.5W</span>
          </button>

          {/* Vibration toggle */}
          <button
            onClick={() => handleToggleTrigger('vibrate')}
            disabled={triggerLoading}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-xs font-bold transition-all border ${
              device.vibrate
                ? 'bg-orange-600 border-orange-400 text-white animate-pulse'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
            }`}
            title="Тест вибромотора GPIO 27"
          >
            <Activity className="w-3.5 h-3.5 text-orange-400" />
            <span className="hidden sm:inline">Вибромотор</span>
          </button>

          {/* Shocker 400kV pulse */}
          <button
            onClick={() => handleToggleTrigger('shock')}
            disabled={triggerLoading}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-xs font-bold transition-all border ${
              device.shock
                ? 'bg-rose-600 border-rose-400 text-white ring-2 ring-rose-500/50 animate-pulse'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-rose-300'
            }`}
            title="Импульс шокера 400 кВ (150 мс)"
          >
            <Zap className="w-3.5 h-3.5 text-rose-400 fill-current" />
            <span className="hidden sm:inline">Шокер 400кВ</span>
          </button>

          {/* Reset button */}
          <button
            onClick={() => handleToggleTrigger('reset')}
            disabled={triggerLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono text-xs font-bold transition-all shadow"
            title="Сброс всех триггеров и возврат в безопасный режим"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline">Сброс</span>
          </button>

          {/* Geofence drawing toggle */}
          {!isDrawing ? (
            <button
              onClick={() => {
                setIsDrawing(true);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 border border-emerald-500/30 rounded font-mono text-xs transition-colors"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Разметить</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDrawing(false);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded font-mono text-xs"
            >
              <X className="w-3.5 h-3.5 text-rose-400" />
              <span>Отмена</span>
            </button>
          )}

          {/* Mobile panel toggle */}
          <button
            onClick={() => setMobilePanelOpen((prev) => !prev)}
            className="md:hidden p-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-300"
          >
            {mobilePanelOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Notification banner */}
      {feedbackMessage && (
        <div className="bg-zinc-900 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between font-mono text-xs text-amber-300 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-zinc-400 hover:text-zinc-100 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. MAP & REAL-TIME HARDWARE TELEMETRY PANEL */}
      <div className="flex-1 flex flex-col md:flex-row relative overflow-hidden">
        {/* Map Canvas */}
        <div
          ref={mapContainerRef}
          className={`flex-1 w-full h-full relative ${isDrawing ? 'cursor-crosshair' : ''}`}
        >
          {/* Map Multi-Zone Legend (Clean high-contrast zinc card) */}
          <div className="absolute top-4 left-4 z-10 bg-zinc-950/95 border border-zinc-800 rounded p-3 text-xs font-mono shadow-xl max-w-xs pointer-events-auto">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 text-zinc-300 font-bold tracking-wider">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                ВИРТУАЛЬНЫЙ ЗАБОР
              </span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-sm bg-emerald-500/30 border border-emerald-500" />
                <span className="text-zinc-300 font-medium">Безопасный выпас (&gt; 20м)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-sm bg-amber-500/30 border border-amber-500 border-dashed" />
                <span className="text-zinc-300 font-medium">Предупреждение: звук (5–20м)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-sm bg-orange-500/30 border border-orange-500 border-dashed" />
                <span className="text-zinc-300 font-medium">Предграничная: вибро (0–5м)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-1.5 bg-rose-500 rounded-sm" />
                <span className="text-zinc-300 font-medium">Периметр забора (шок 400кВ)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Drawing Controls Floating Banner */}
        {isDrawing && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md w-full px-4">
            <div className="bg-zinc-950 rounded p-3 text-white shadow-xl border border-amber-500/60 flex items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-amber-400 font-bold">Кликайте по карте для контура</div>
                  <div className="text-zinc-400 text-[11px]">
                    Точек: <span className="text-white font-bold">{drawPoints.length}</span> (мин. 3)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setDrawPoints((prev) => prev.slice(0, prev.length - 1))}
                  disabled={drawPoints.length === 0}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs disabled:opacity-40"
                  title="Отменить точку"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (drawPoints.length >= 3) setIsSaveModalOpen(true);
                  }}
                  disabled={drawPoints.length < 3}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded text-xs disabled:opacity-40 shadow"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. DOCKED RIGHT PANEL: REAL-TIME LIVESTOCK TELEMETRY & STEERING PANEL */}
        <aside
          className={`w-full md:w-96 bg-zinc-950 border-t md:border-t-0 md:border-l border-zinc-800 p-4 flex flex-col shrink-0 z-20 overflow-y-auto ${
            mobilePanelOpen ? 'block' : 'hidden md:flex'
          }`}
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-xs uppercase tracking-wider text-zinc-200 font-mono">
                Телеметрия ошейника ESP32
              </span>
            </div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 font-semibold">
              WROVER-E
            </span>
          </div>

          {/* Prominent Zone Status Badge Card */}
          <div className={`mt-3 p-3.5 rounded border transition-all ${zoneConfig.badgeClass}`}>
            <div className="flex items-start gap-2.5">
              {zoneConfig.icon}
              <div className="flex-1 min-w-0">
                <div className="font-mono font-extrabold text-xs tracking-wide">
                  {zoneConfig.title}
                </div>
                <div className="text-[11px] text-zinc-300 mt-0.5 leading-snug">
                  {zoneConfig.subtitle}
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Distance & Audio Telemetry Widgets */}
          <div className="grid grid-cols-2 gap-2.5 my-3 font-mono">
            {/* Distance to Border Widget */}
            <div className="p-3 rounded bg-zinc-900/90 border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-400 text-[10px] tracking-wider uppercase font-semibold">
                <span>До границы</span>
                <Ruler className="w-3.5 h-3.5 text-zinc-400" />
              </div>
              <div
                className={`text-lg font-extrabold mt-1 ${
                  currentDistance > 20
                    ? 'text-emerald-400'
                    : currentDistance > 5
                      ? 'text-amber-400'
                      : currentDistance >= 0
                        ? 'text-orange-400'
                        : 'text-rose-400'
                }`}
              >
                {currentDistance >= 0 ? `+${currentDistance.toFixed(1)} м` : `${currentDistance.toFixed(1)} м`}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1 truncate">
                {currentDistance >= 0 ? 'Внутри контура' : 'Снаружи периметра'}
              </div>
            </div>

            {/* Audio Tone Frequency Widget */}
            <div className="p-3 rounded bg-zinc-900/90 border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-400 text-[10px] tracking-wider uppercase font-semibold">
                <span>Частота I2S</span>
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div
                className={`text-lg font-extrabold mt-1 ${
                  currentToneFreq > 0 ? 'text-amber-400 animate-pulse' : 'text-zinc-500'
                }`}
              >
                {currentToneFreq > 0 ? `${currentToneFreq} Гц` : '0 Гц'}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1 truncate">
                {currentToneFreq > 0 ? 'Сирена MAX98357' : 'Звук выключен'}
              </div>
            </div>
          </div>

          {/* Actuator Indicators & Hardware Status */}
          <div className="p-3 rounded bg-zinc-900/90 border border-zinc-800 space-y-2.5 font-mono text-[11px]">
            <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider border-b border-zinc-800 pb-1.5 flex items-center justify-between">
              <span>Исполнительные датчики</span>
              <span className="text-zinc-500 text-[9px]">GPIO BUS</span>
            </div>

            {/* 0.5W I2S Siren (MAX98357) */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Сирена 0.5W (I2S):</span>
              </div>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                  device.sound || currentZone === 'YELLOW' || currentZone === 'ORANGE' || currentZone === 'RED'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {device.sound || currentToneFreq > 0 ? `АКТИВЕН (${currentToneFreq || 1100} Гц)` : 'ВЫКЛ'}
              </span>
            </div>

            {/* Vibration Motor */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Activity className="w-3.5 h-3.5 text-orange-400" />
                <span>Вибромотор (GPIO 27):</span>
              </div>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                  device.vibrate || currentZone === 'ORANGE' || currentZone === 'RED'
                    ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 animate-pulse'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {device.vibrate || currentZone === 'ORANGE' || currentZone === 'RED'
                  ? 'ВИБРО-ИМПУЛЬС'
                  : 'ВЫКЛ'}
              </span>
            </div>

            {/* 400kV Pulse Shocker with 150ms badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                <span className="flex items-center gap-1">
                  Шокер 400кВ:
                  <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    150 мс
                  </span>
                </span>
              </div>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                  currentZone === 'ESCAPE'
                    ? 'bg-red-950 text-red-400 border border-red-500/50'
                    : device.shock || currentZone === 'RED'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 animate-pulse'
                      : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {currentZone === 'ESCAPE'
                  ? 'БЛОКИРОВКА АНТИ-ПАНИКА'
                  : device.shock || currentZone === 'RED'
                    ? 'РАЗРЯД 400кВ (150мс)'
                    : 'ГОТОВ'}
              </span>
            </div>
          </div>

          {/* Hardware Telemetry metrics (Battery, GPS Accuracy, Signal) */}
          <div className="grid grid-cols-3 gap-2 my-3 font-mono text-[11px]">
            <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800">
              <span className="text-zinc-500 block text-[9px] uppercase font-semibold">Батарея</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                <Battery className="w-3.5 h-3.5" />
                {device.battery != null ? `${device.battery}%` : '92%'}
              </span>
            </div>

            <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800">
              <span className="text-zinc-500 block text-[9px] uppercase font-semibold">Точность GPS</span>
              <span className="text-zinc-200 font-bold flex items-center gap-1 mt-0.5">
                <Compass className="w-3.5 h-3.5 text-emerald-400" />
                {device.gpsAccuracy != null ? `±${device.gpsAccuracy}м` : '±2.8м'}
              </span>
            </div>

            <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800">
              <span className="text-zinc-500 block text-[9px] uppercase font-semibold">Сигнал Wi-Fi</span>
              <span className="text-zinc-200 font-bold flex items-center gap-1 mt-0.5">
                <Signal className="w-3.5 h-3.5 text-zinc-400" />
                {device.signal != null ? `${device.signal} dBm` : '-68 dBm'}
              </span>
            </div>
          </div>

          {/* Quick Zone Simulation / Manual Field Test Buttons */}
          <div className="my-2 p-3 rounded bg-zinc-900/90 border border-zinc-800 font-mono">
            <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-2 flex items-center justify-between">
              <span>Стресс-тест зон и триггеров</span>
              <span className="text-zinc-500 text-[9px]">Ручной контроль</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleSimulateZone('GREEN')}
                disabled={triggerLoading}
                className={`px-2 py-1.5 rounded text-[11px] font-bold border transition-colors flex items-center justify-center gap-1 ${
                  currentZone === 'GREEN'
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
                }`}
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>Безопасная</span>
              </button>

              <button
                onClick={() => handleSimulateZone('YELLOW')}
                disabled={triggerLoading}
                className={`px-2 py-1.5 rounded text-[11px] font-bold border transition-colors flex items-center justify-center gap-1 ${
                  currentZone === 'YELLOW'
                    ? 'bg-amber-950 border-amber-500 text-amber-300'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
                }`}
              >
                <Volume2 className="w-3 h-3 text-amber-400" />
                <span>Предупреждение</span>
              </button>

              <button
                onClick={() => handleSimulateZone('ORANGE')}
                disabled={triggerLoading}
                className={`px-2 py-1.5 rounded text-[11px] font-bold border transition-colors flex items-center justify-center gap-1 ${
                  currentZone === 'ORANGE'
                    ? 'bg-orange-950 border-orange-500 text-orange-300'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
                }`}
              >
                <Activity className="w-3 h-3 text-orange-400" />
                <span>Предграничная</span>
              </button>

              <button
                onClick={() => handleSimulateZone('RED')}
                disabled={triggerLoading}
                className={`px-2 py-1.5 rounded text-[11px] font-bold border transition-colors flex items-center justify-center gap-1 ${
                  currentZone === 'RED'
                    ? 'bg-rose-950 border-rose-500 text-rose-300'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-400'
                }`}
              >
                <Zap className="w-3 h-3 text-rose-400 fill-current" />
                <span>Нарушение</span>
              </button>
            </div>

            <button
              onClick={() => handleSimulateZone('ESCAPE')}
              disabled={triggerLoading}
              className={`w-full mt-2 px-2.5 py-1.5 rounded text-[11px] font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                currentZone === 'ESCAPE'
                  ? 'bg-red-950 border-red-500 text-red-200'
                  : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-red-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span>Анти-паника (Блокировка шокера)</span>
            </button>
          </div>

          {/* Pasture Geofences List */}
          <div className="mt-2 flex-1 flex flex-col font-mono">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5 font-bold">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                ГЕОЗОНЫ ({geofences.length > 0 ? geofences.length : 1})
              </span>
            </div>

            <div className="py-2 space-y-2 flex-1 overflow-y-auto">
              {geofences.length > 0 ? (
                geofences.map((gf) => (
                  <div
                    key={gf.id}
                    className="p-2.5 rounded bg-zinc-900/90 border border-zinc-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-zinc-200 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                        {gf.name}
                      </div>
                      {gf.description && (
                        <div className="text-[10px] text-zinc-400 mt-0.5">{gf.description}</div>
                      )}
                    </div>

                    <button
                      onClick={async () => {
                        if (confirm(`Удалить зону «${gf.name}»?`)) {
                          await ApiClient.deleteGeofence(gf.id);
                          fetchLiveStatus();
                        }
                      }}
                      className="p-1 text-zinc-400 hover:text-rose-400 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-2.5 rounded bg-zinc-900/90 border border-zinc-800 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-zinc-200 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      Пастбище Актау (Активно)
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      Многозонный виртуальный забор
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Save Geofence Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 font-mono">
          <div className="bg-zinc-900 border border-zinc-800 rounded w-full max-w-md p-5 text-xs shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PenTool className="w-4 h-4 text-emerald-400" />
                Сохранение геозоны пастбища
              </h3>
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGeofence} className="space-y-4 pt-4">
              <div>
                <label className="block text-zinc-400 mb-1">Название геозоны</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500 font-sans"
                  required
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Описание (опционально)</label>
                <input
                  type="text"
                  value={newGeofenceDesc}
                  onChange={(e) => setNewGeofenceDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500 font-sans"
                />
              </div>

              <div className="p-3 rounded bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                <div className="text-zinc-300 font-bold">Автоматические зоны виртуального забора:</div>
                <div>• Зеленый: безопасный выпас (&gt; 20м от границы)</div>
                <div>• Желтый: буфер предупреждения (5–20м, сирена 800-1400 Гц)</div>
                <div>• Оранжевый: предграничная зона (0–5м, сирена + вибромотор)</div>
                <div>• Красный: периметр забора (импульс шокера 400кВ, 150 мс)</div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-bold"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={savingGeofence}
                  className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50"
                >
                  {savingGeofence ? 'Сохранение...' : 'Сохранить геозону'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-zinc-400 font-mono text-xs">
          Загрузка карты пастбищ...
        </div>
      }
    >
      <LiveMapContent />
    </Suspense>
  );
}
