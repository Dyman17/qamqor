'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
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
  VolumeX,
  Layers,
  Signal,
  Wifi,
  WifiOff,
} from 'lucide-react';

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
  buzzer: boolean;
}

function LiveMapContent() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [device, setDevice] = useState<DeviceStatus>({
    deviceId: 'QAM-0001',
    isOnline: false,
    status: 'OFFLINE',
    secondsSinceLastPing: null,
    lastHeartbeatAt: null,
    battery: null,
    signal: null,
    lastLatitude: null,
    lastLongitude: null,
    buzzer: false,
  });

  const [geofences, setGeofences] = useState<any[]>([]);
  const [buzzerLoading, setBuzzerLoading] = useState<boolean>(false);
  const [buzzerMessage, setBuzzerMessage] = useState<string | null>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('Пастбище 1');
  const [newGeofenceDesc, setNewGeofenceDesc] = useState('');
  const [newGeofenceColor, setNewGeofenceColor] = useState('#10b981');
  const [savingGeofence, setSavingGeofence] = useState(false);

  // 1. Fetch real hardware device status & geofences
  const fetchLiveStatus = async () => {
    try {
      const [devStatus, geofencesData] = await Promise.all([
        ApiClient.getDeviceStatus('QAM-0001').catch(() => null),
        ApiClient.listGeofences().catch(() => []),
      ]);

      if (devStatus) {
        setDevice(devStatus);
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

  // 2. Hardware Buzzer Toggle Handler
  const handleToggleBuzzer = async () => {
    setBuzzerLoading(true);
    const targetState = !device.buzzer;
    try {
      await ApiClient.setBuzzer(targetState, 'QAM-0001');
      setDevice((prev) => ({ ...prev, buzzer: targetState }));
      setBuzzerMessage(
        targetState
          ? '🚨 Зуммер ВКЛЮЧЕН! ESP32 запищит при следующем пинге (в течение 3-5 сек).'
          : '🔇 Зуммер ВЫКЛЮЧЕН. Команда остановки отправлена.',
      );
      setTimeout(() => setBuzzerMessage(null), 5000);
      fetchLiveStatus();
    } catch (err: any) {
      console.error('Buzzer error:', err);
      setBuzzerMessage('❌ Ошибка отправки команды');
      setTimeout(() => setBuzzerMessage(null), 4000);
    } finally {
      setBuzzerLoading(false);
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
        zoom: 13,
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

  // 4. Render Geofence Polygons from DB
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const renderLayers = () => {
      geofences.forEach((gf) => {
        const sourceId = `source-gf-${gf.id}`;
        const fillLayerId = `layer-fill-${gf.id}`;
        const lineLayerId = `layer-line-${gf.id}`;

        let geojson: any = null;
        if (typeof gf.polygonJson === 'string') {
          try {
            geojson = JSON.parse(gf.polygonJson);
          } catch {}
        } else if (typeof gf.polygonJson === 'object') {
          geojson = gf.polygonJson;
        }

        if (!geojson) return;

        if (map.getSource(sourceId)) {
          map.getSource(sourceId).setData(geojson);
        } else {
          map.addSource(sourceId, {
            type: 'geojson',
            data: geojson,
          });

          map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': gf.color || '#10b981',
              'fill-opacity': 0.15,
            },
          });

          map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': gf.color || '#10b981',
              'line-width': 2.5,
              'line-dasharray': [2, 1],
            },
          });
        }
      });
    };

    if (map.isStyleLoaded()) {
      renderLayers();
    } else {
      map.once('load', renderLayers);
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
          paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.25 },
        });
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#f59e0b', 'line-width': 3 },
        });
      }
    }
  }, [drawPoints]);

  // 6. Render ONLY the Real Collar on the Map (if coordinates exist!)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (device.lastLatitude == null || device.lastLongitude == null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    import('maplibre-gl').then((maplibreglModule) => {
      const maplibregl = maplibreglModule.default;
      const lat = device.lastLatitude!;
      const lng = device.lastLongitude!;
      const isBreached = device.buzzer;

      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const el = document.createElement('div');
        el.className = 'custom-device-marker';
        el.innerHTML = `
          <div class="relative flex items-center justify-center cursor-pointer">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg transition-transform hover:scale-110 ${
              isBreached
                ? 'bg-rose-600 ring-4 ring-rose-500/40 animate-pulse'
                : 'bg-emerald-600 ring-2 ring-emerald-400'
            }">
              ESP
            </div>
            <div class="absolute -bottom-5 whitespace-nowrap px-1.5 py-0.5 rounded bg-slate-900 text-[10px] text-white border border-slate-700 font-mono shadow">
              ${device.deviceId}
            </div>
          </div>
        `;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);

        markerRef.current = marker;
      }
    });
  }, [device.lastLatitude, device.lastLongitude, device.buzzer]);

  // 7. Save Geofence Handler
  const handleSaveGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drawPoints.length < 3) return;

    setSavingGeofence(true);
    try {
      const closedPoints = [...drawPoints, drawPoints[0]];
      const polygonGeoJson = {
        type: 'Feature',
        properties: { name: newGeofenceName, color: newGeofenceColor },
        geometry: {
          type: 'Polygon',
          coordinates: [closedPoints],
        },
      };

      await ApiClient.createGeofence({
        name: newGeofenceName,
        description: newGeofenceDesc,
        polygonJson: polygonGeoJson,
        color: newGeofenceColor,
      });

      setIsSaveModalOpen(false);
      setIsDrawing(false);
      setDrawPoints([]);
      fetchLiveStatus();
    } catch (err) {
      console.error('Failed to create geofence:', err);
    } finally {
      setSavingGeofence(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden font-mono text-xs">
      {/* 1. TOP BAR: DIRECT BUZZER TOGGLE & GEOFENCE ACTIONS */}
      <div className="h-16 px-4 md:px-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 z-20">
        {/* Device Status Badge */}
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-200 text-sm">{device.deviceId}</span>
          {device.isOnline ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              В СЕТИ ({device.secondsSinceLastPing != null ? `${device.secondsSinceLastPing}с назад` : 'только что'})
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              НЕ В СЕТИ (нет связи с ESP32)
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleToggleBuzzer}
            disabled={buzzerLoading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-bold tracking-wide transition-all shadow-lg ${
              device.buzzer
                ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse ring-4 ring-rose-500/40'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold'
            } disabled:opacity-50`}
          >
            {device.buzzer ? (
              <>
                <Volume2 className="w-5 h-5 fill-current animate-bounce" />
                <span>🚨 ЗУММЕР ВКЛЮЧЕН (ПИЩИТ) — ВЫКЛЮЧИТЬ</span>
              </>
            ) : (
              <>
                <VolumeX className="w-5 h-5" />
                <span>🔊 ВКЛЮЧИТЬ ЗУММЕР (ТЕСТ)</span>
              </>
            )}
          </button>

          {!isDrawing ? (
            <button
              onClick={() => {
                setIsDrawing(true);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 rounded text-xs transition-colors"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Разметить зону</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDrawing(false);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
            >
              <X className="w-3.5 h-3.5" />
              <span>Отмена</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification banner */}
      {buzzerMessage && (
        <div className="bg-slate-900 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
          <span>{buzzerMessage}</span>
          <button onClick={() => setBuzzerMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* 2. MAP & REAL HARDWARE TELEMETRY */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Map Canvas */}
        <div
          ref={mapContainerRef}
          className={`flex-1 w-full h-full relative ${isDrawing ? 'cursor-crosshair' : ''}`}
        />

        {/* Drawing Controls Floating Banner */}
        {isDrawing && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md w-full px-4">
            <div className="bg-slate-950/95 backdrop-blur-sm rounded p-3 text-white shadow-xl border border-amber-500/50 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-amber-400 font-bold">Кликайте по карте для разметки</div>
                  <div className="text-slate-400 text-[11px]">
                    Точек: <span className="text-white font-bold">{drawPoints.length}</span> (мин. 3)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setDrawPoints((prev) => prev.slice(0, prev.length - 1))}
                  disabled={drawPoints.length === 0}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs disabled:opacity-40"
                  title="Отменить точку"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (drawPoints.length >= 3) setIsSaveModalOpen(true);
                  }}
                  disabled={drawPoints.length < 3}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs disabled:opacity-40 shadow"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. DOCKED RIGHT PANEL: REAL ESP32 HARDWARE STATUS */}
        <div className="w-80 md:w-88 bg-slate-950 border-l border-slate-800 p-4 flex flex-col shrink-0 z-20 overflow-y-auto">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                Ошейник {device.deviceId}
              </span>
            </div>
            {device.isOnline ? (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                В СЕТИ
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                НЕ В СЕТИ
              </span>
            )}
          </div>

          {/* Real Device Data */}
          <div className="my-3 p-3 rounded bg-slate-900 border border-slate-800 space-y-2.5">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">АККУМУЛЯТОР</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                  <Battery className="w-3.5 h-3.5" />
                  {device.battery != null ? `${device.battery}%` : '—'}
                </span>
              </div>

              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">СИГНАЛ WI-FI</span>
                <span className="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
                  <Signal className="w-3.5 h-3.5 text-blue-400" />
                  {device.signal != null ? `${device.signal} dBm` : '—'}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Состояние зуммера:</span>
                <span className={`font-bold ${device.buzzer ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}`}>
                  {device.buzzer ? '🔊 ПИЩИТ (ВКЛ)' : '🔇 ВЫКЛЮЧЕН'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Последний опрос:</span>
                <span className="text-slate-300">
                  {device.lastHeartbeatAt
                    ? new Date(device.lastHeartbeatAt).toLocaleTimeString('ru-RU')
                    : 'Нет данных'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">GPS Координаты:</span>
                <span className="text-slate-300">
                  {device.lastLatitude != null && device.lastLongitude != null
                    ? `${device.lastLatitude.toFixed(4)}, ${device.lastLongitude.toFixed(4)}`
                    : 'Ожидание фиксации GPS'}
                </span>
              </div>
            </div>
          </div>

          {/* Pasture Geofences List */}
          <div className="mt-2 flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                ГЕОЗОНЫ ({geofences.length})
              </span>
            </div>

            <div className="py-2 space-y-2 flex-1 overflow-y-auto">
              {geofences.length > 0 ? (
                geofences.map((gf) => (
                  <div
                    key={gf.id}
                    className="p-2.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: gf.color || '#10b981' }}
                        />
                        {gf.name}
                      </div>
                      {gf.description && <div className="text-[10px] text-slate-400 mt-0.5">{gf.description}</div>}
                    </div>

                    <button
                      onClick={async () => {
                        if (confirm(`Удалить зону «${gf.name}»?`)) {
                          await ApiClient.deleteGeofence(gf.id);
                          fetchLiveStatus();
                        }
                      }}
                      className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-slate-500 text-xs">
                  Зоны пока не размечены.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Geofence Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded w-full max-w-md p-5 text-xs shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PenTool className="w-4 h-4 text-emerald-400" />
                Сохранение геозоны
              </h3>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSaveGeofence} className="space-y-4 pt-4">
              <div>
                <label className="block text-slate-400 mb-1">Название геозоны</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Описание (опционально)</label>
                <input
                  type="text"
                  value={newGeofenceDesc}
                  onChange={(e) => setNewGeofenceDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Цвет контура</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newGeofenceColor}
                    onChange={(e) => setNewGeofenceColor(e.target.value)}
                    className="w-8 h-8 rounded border-0 bg-transparent cursor-pointer"
                  />
                  <span className="text-slate-300">{newGeofenceColor}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={savingGeofence}
                  className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50"
                >
                  {savingGeofence ? 'Сохранение...' : 'Сохранить'}
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
    <Suspense fallback={<div className="p-8 text-center text-slate-400 font-mono text-xs">Загрузка...</div>}>
      <LiveMapContent />
    </Suspense>
  );
}
