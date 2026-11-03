'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiClient } from '../../../lib/api';
import {
  Radio,
  Battery,
  AlertTriangle,
  MapPin,
  PenTool,
  Check,
  X,
  Undo2,
  Trash2,
  Volume2,
  VolumeX,
  Activity,
  Layers,
  Signal,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

function LiveMapContent() {
  const searchParams = useSearchParams();
  const urlAnimalId = searchParams.get('animalId');

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<{ [key: string]: any }>({});

  const [animals, setAnimals] = useState<any[]>([]);
  const [geofences, setGeofences] = useState<any[]>([]);
  const [selectedAnimal, setSelectedAnimal] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Hardware Buzzer State
  const [buzzerActive, setBuzzerActive] = useState<boolean>(false);
  const [buzzerLoading, setBuzzerLoading] = useState<boolean>(false);
  const [buzzerMessage, setBuzzerMessage] = useState<string | null>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('Жайлау №2');
  const [newGeofenceDesc, setNewGeofenceDesc] = useState('Зона контролируемого выпаса');
  const [newGeofenceColor, setNewGeofenceColor] = useState('#10b981');
  const [savingGeofence, setSavingGeofence] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // 1. Fetch live data & sync buzzer status
  const fetchData = async () => {
    try {
      const [animalsData, geofencesData, buzzerData] = await Promise.all([
        ApiClient.listAnimals().catch(() => []),
        ApiClient.listGeofences().catch(() => []),
        ApiClient.getBuzzer('QAM-0001').catch(() => ({ buzzer: false })),
      ]);

      setAnimals(animalsData || []);
      setGeofences(geofencesData || []);
      if (buzzerData && typeof buzzerData.buzzer === 'boolean') {
        setBuzzerActive(buzzerData.buzzer);
      }

      setSelectedAnimal((prev: any) => {
        if (urlAnimalId) {
          const match = (animalsData || []).find((a: any) => a.id === urlAnimalId);
          if (match) return match;
        }
        if (prev) {
          const updated = (animalsData || []).find((a: any) => a.id === prev.id);
          return updated || prev;
        }
        return (animalsData || [])[0] || null;
      });
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 4000);
    return () => clearInterval(timer);
  }, []);

  // 2. Hardware Buzzer Toggle Handler
  const handleToggleBuzzer = async () => {
    setBuzzerLoading(true);
    const targetState = !buzzerActive;
    try {
      const res = await ApiClient.setBuzzer(targetState, 'QAM-0001');
      setBuzzerActive(targetState);
      setBuzzerMessage(
        targetState
          ? '🚨 Зуммер ВКЛЮЧЕН! ESP32 начнет непрерывно пищать при следующем запросе.'
          : '🔇 Зуммер ВЫКЛЮЧЕН. Звуковой сигнал на ESP32 остановлен.',
      );
      setTimeout(() => setBuzzerMessage(null), 5000);
      fetchData();
    } catch (err: any) {
      console.error('Buzzer error:', err);
      setBuzzerMessage('❌ Ошибка отправки команды на сервер');
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

  // 4. Render Geofence Polygons
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

  // 6. Render Animal / Collar Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    import('maplibre-gl').then((maplibreglModule) => {
      const maplibregl = maplibreglModule.default;

      animals.forEach((animal) => {
        const lat = animal.lastLatitude ?? 43.6501;
        const lng = animal.lastLongitude ?? 51.1572;
        const isBreached = animal.isOutsideGeofence || buzzerActive;
        const isSelected = selectedAnimal?.id === animal.id;

        if (markersRef.current[animal.id]) {
          markersRef.current[animal.id].setLngLat([lng, lat]);
          const el = markersRef.current[animal.id].getElement();
          if (el) {
            el.className = `custom-marker ${isBreached ? 'breach-marker' : 'normal-marker'} ${isSelected ? 'selected-marker' : ''}`;
          }
        } else {
          const el = document.createElement('div');
          el.className = `custom-marker ${isBreached ? 'breach-marker' : 'normal-marker'} ${isSelected ? 'selected-marker' : ''}`;

          el.innerHTML = `
            <div class="relative flex items-center justify-center cursor-pointer">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg transition-transform hover:scale-110 ${
                isBreached ? 'bg-rose-600 ring-4 ring-rose-500/30 animate-pulse' : 'bg-emerald-600 ring-2 ring-emerald-400'
              }">
                ${animal.species === 'CAMEL' ? 'CAM' : animal.species === 'HORSE' ? 'HRS' : 'COW'}
              </div>
              <div class="absolute -bottom-5 whitespace-nowrap px-1.5 py-0.5 rounded bg-slate-900/90 text-[10px] text-white border border-slate-700 font-mono shadow">
                ${animal.name} (${animal.device?.deviceId || 'QAM'})
              </div>
            </div>
          `;

          el.addEventListener('click', () => {
            setSelectedAnimal(animal);
          });

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);

          markersRef.current[animal.id] = marker;
        }
      });
    });
  }, [animals, selectedAnimal?.id, buzzerActive]);

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

      setStatusNotification(`Геозона «${newGeofenceName}» успешно сохранена в базе`);
      setIsSaveModalOpen(false);
      setIsDrawing(false);
      setDrawPoints([]);
      fetchData();
    } catch (err) {
      console.error('Failed to create geofence:', err);
      setStatusNotification('Ошибка сохранения геозоны на сервере');
    } finally {
      setSavingGeofence(false);
      setTimeout(() => setStatusNotification(null), 4000);
    }
  };

  const activeDevice = selectedAnimal?.device || {
    deviceId: 'QAM-0001',
    status: 'ONLINE',
    battery: 92,
    signal: -72,
    lastHeartbeatAt: new Date().toISOString(),
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. TOP ACTION BAR: BIG BUZZER TOGGLE & GEOFENCE ACTIONS */}
      <div className="h-16 px-4 md:px-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 z-20">
        {/* Left: Device selector */}
        <div className="flex items-center gap-3 overflow-x-auto py-1">
          <span className="text-[11px] font-mono uppercase text-slate-400 shrink-0">Ошейник:</span>
          {animals.length > 0 ? (
            animals.map((a) => {
              const isSelected = selectedAnimal?.id === a.id;
              const isBreach = a.isOutsideGeofence || (isSelected && buzzerActive);
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    setSelectedAnimal(a);
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo({
                        center: [a.lastLongitude ?? 51.1572, a.lastLatitude ?? 43.6501],
                        zoom: 15,
                        duration: 600,
                      });
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-colors ${
                    isSelected
                      ? isBreach
                        ? 'bg-rose-600 text-white shadow-md'
                        : 'bg-emerald-600 text-white shadow-md'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  <span>{a.name}</span>
                  <span className="text-[10px] opacity-80">({a.device?.deviceId || 'QAM'})</span>
                  {isBreach && <AlertTriangle className="w-3.5 h-3.5 text-white animate-pulse" />}
                </button>
              );
            })
          ) : (
            <span className="text-xs text-slate-400 font-mono">QAM-0001 (Подключен по Wi-Fi)</span>
          )}
        </div>

        {/* Center/Right: THE MAIN BUZZER BUTTON */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleToggleBuzzer}
            disabled={buzzerLoading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-mono font-bold tracking-wide transition-all shadow-lg ${
              buzzerActive
                ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse ring-4 ring-rose-500/40'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold'
            } disabled:opacity-50`}
            title="Прямое управление зуммером ошейника ESP32"
          >
            {buzzerActive ? (
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
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 rounded-md text-xs font-mono font-medium transition-colors"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Разметить пастбище</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDrawing(false);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-mono"
            >
              <X className="w-3.5 h-3.5" />
              <span>Отмена</span>
            </button>
          )}
        </div>
      </div>

      {/* Buzzer Feedback Notification Banner */}
      {buzzerMessage && (
        <div className="bg-slate-900 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between text-xs font-mono text-amber-300">
          <span>{buzzerMessage}</span>
          <button onClick={() => setBuzzerMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* 2. MAP & HARDWARE STATUS WORKSPACE */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Map Canvas */}
        <div
          ref={mapContainerRef}
          className={`flex-1 w-full h-full relative ${isDrawing ? 'cursor-crosshair' : ''}`}
        />

        {/* Drawing Controls Floating Banner */}
        {isDrawing && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md w-full px-4">
            <div className="bg-slate-950/95 backdrop-blur-sm rounded-md p-3 text-white shadow-xl border border-amber-500/50 flex items-center justify-between gap-3 text-xs font-mono">
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
        <div className="w-80 md:w-88 bg-slate-950 border-l border-slate-800 p-4 flex flex-col shrink-0 z-20 overflow-y-auto font-mono text-xs">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                Ошейник ESP32
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              В СЕТИ
            </span>
          </div>

          {/* Active Collar Data Card */}
          <div className="my-3 p-3 rounded-md bg-slate-900 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">
                {selectedAnimal ? `${selectedAnimal.name} (${selectedAnimal.tagNumber})` : 'Верблюд «Ақтабан»'}
              </span>
              <span className="text-[11px] font-bold text-emerald-400">
                {activeDevice.deviceId || 'QAM-0001'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">ЗАРЯД АКБ</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1 mt-0.5">
                  <Battery className="w-3.5 h-3.5" />
                  {activeDevice.battery ?? 92}%
                </span>
              </div>

              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">СИГНАЛ WI-FI</span>
                <span className="text-slate-200 font-bold flex items-center gap-1 mt-0.5">
                  <Signal className="w-3.5 h-3.5 text-blue-400" />
                  {activeDevice.signal ?? -72} dBm
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Статус зуммера:</span>
                <span className={`font-bold ${buzzerActive ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}`}>
                  {buzzerActive ? '🔊 АКТИВЕН (ПИЩИТ)' : '🔇 ВЫКЛЮЧЕН'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Последний опрос:</span>
                <span className="text-slate-300">
                  {activeDevice.lastHeartbeatAt
                    ? new Date(activeDevice.lastHeartbeatAt).toLocaleTimeString('ru-RU')
                    : 'Только что'}
                </span>
              </div>
            </div>
          </div>

          {/* Pasture Geofences List */}
          <div className="mt-2 flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                АКТИВНЫЕ ПАСТБИЩА ({geofences.length})
              </span>
            </div>

            <div className="py-2 space-y-2 flex-1 overflow-y-auto">
              {geofences.length > 0 ? (
                geofences.map((gf) => (
                  <div
                    key={gf.id}
                    className="p-2.5 rounded-md bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: gf.color || '#10b981' }}
                        />
                        {gf.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{gf.description || 'Контроль выпаса'}</div>
                    </div>

                    <button
                      onClick={async () => {
                        if (confirm(`Удалить пастбище «${gf.name}»?`)) {
                          await ApiClient.deleteGeofence(gf.id);
                          fetchData();
                        }
                      }}
                      className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                      title="Удалить пастбище"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-slate-400 text-xs">
                  Пастбища пока не созданы. Нажмите «Разметить пастбище» вверху.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Geofence Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-md w-full max-w-md p-5 text-xs font-mono shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PenTool className="w-4 h-4 text-emerald-400" />
                Сохранение границ пастбища
              </h3>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSaveGeofence} className="space-y-4 pt-4">
              <div>
                <label className="block text-slate-400 mb-1">Название пастбища</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Описание</label>
                <input
                  type="text"
                  value={newGeofenceDesc}
                  onChange={(e) => setNewGeofenceDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Цвет границы</label>
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
                  {savingGeofence ? 'Сохранение...' : 'Сохранить пастбище'}
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
    <Suspense fallback={<div className="p-8 text-center text-slate-400 font-mono text-xs">Загрузка карты...</div>}>
      <LiveMapContent />
    </Suspense>
  );
}
