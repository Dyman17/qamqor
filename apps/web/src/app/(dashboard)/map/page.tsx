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
  Trees,
  CheckCircle2,
  Zap,
  Volume2,
  VolumeX,
  Copy,
  CheckCheck,
  MousePointerClick,
  Activity,
  Layers,
  Signal,
  RotateCcw,
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

  // ESP32 Telemetry & Vibration State
  const [esp32Response, setEsp32Response] = useState<any>(null);
  const [lastRequestPayload, setLastRequestPayload] = useState<any>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualLat, setManualLat] = useState('43.6501');
  const [manualLng, setManualLng] = useState('51.1572');

  // Geofence Polygon Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]); // Array of [lng, lat]
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('Жайлау №2');
  const [newGeofenceDesc, setNewGeofenceDesc] = useState('Зона контролируемого выпаса');
  const [newGeofenceColor, setNewGeofenceColor] = useState('#10b981');
  const [savingGeofence, setSavingGeofence] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // 1. Fetch live data
  const fetchData = async () => {
    try {
      const [animalsData, geofencesData] = await Promise.all([
        ApiClient.listAnimals(),
        ApiClient.listGeofences(),
      ]);
      setAnimals(animalsData || []);
      setGeofences(geofencesData || []);

      setSelectedAnimal((prev: any) => {
        if (urlAnimalId) {
          const match = animalsData.find((a: any) => a.id === urlAnimalId);
          if (match) return match;
        }
        if (prev) {
          const updated = animalsData.find((a: any) => a.id === prev.id);
          return updated || prev;
        }
        return animalsData[0] || null;
      });
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 8000);
    return () => clearInterval(timer);
  }, []);

  // Update response state whenever selected animal changes
  useEffect(() => {
    if (selectedAnimal) {
      const isOutside = selectedAnimal.isOutsideGeofence;
      setEsp32Response({
        success: true,
        serverTime: new Date().toISOString(),
        inFence: !isOutside,
        vibrate: isOutside,
        vibrateDurationMs: isOutside ? 3000 : 0,
        buzzer: isOutside,
        warningMessage: isOutside
          ? 'GEOFENCE_BREACH: Скот вышел за пределы пастбища. Вибрация активна.'
          : 'Внутри границ пастбища. Вибрация выключена.',
        nextInterval: isOutside ? 60 : 300,
        configVersion: 1,
      });

      setLastRequestPayload({
        deviceId: selectedAnimal.device?.deviceId || 'QAM-0001',
        latitude: selectedAnimal.lastLatitude || 43.6501,
        longitude: selectedAnimal.lastLongitude || 51.1572,
        battery: selectedAnimal.device?.battery || 90,
        accuracy: 3.5,
        timestamp: new Date().toISOString(),
      });

      if (selectedAnimal.lastLatitude) setManualLat(selectedAnimal.lastLatitude.toFixed(6));
      if (selectedAnimal.lastLongitude) setManualLng(selectedAnimal.lastLongitude.toFixed(6));
    }
  }, [selectedAnimal?.id, selectedAnimal?.isOutsideGeofence]);

  // 2. Initialize MapLibre GL
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
              id: 'osm-layer',
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

      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      mapInstanceRef.current = map;

      map.on('load', () => {
        renderPastures(map, geofences);
      });
    }

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 3. Render Pasture Polygons
  const renderPastures = (map: any, geofenceList: any[]) => {
    if (!map || !map.isStyleLoaded()) return;

    geofenceList.forEach((gf, idx) => {
      const sourceId = `geofence-source-${gf.id || idx}`;
      const fillLayerId = `geofence-fill-${gf.id || idx}`;
      const lineLayerId = `geofence-line-${gf.id || idx}`;

      if (map.getSource(sourceId)) {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
        map.removeSource(sourceId);
      }

      if (gf.polygonJson) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: gf.polygonJson,
            properties: { name: gf.name, color: gf.color || '#10b981' },
          },
        });

        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': gf.color || '#10b981',
            'fill-opacity': 0.18,
          },
        });

        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': gf.color || '#10b981',
            'line-width': 2.5,
            'line-dasharray': [3, 2],
          },
        });
      }
    });
  };

  useEffect(() => {
    if (mapInstanceRef.current && geofences.length > 0) {
      renderPastures(mapInstanceRef.current, geofences);
    }
  }, [geofences]);

  // 4. Update Animal Markers with clean SVG badges
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    import('maplibre-gl').then((maplibreglModule) => {
      const maplibregl = maplibreglModule.default;

      animals.forEach((animal) => {
        const lat = animal.lastLatitude || 43.6501;
        const lng = animal.lastLongitude || 51.1572;
        const isBreached = animal.isOutsideGeofence;
        const isSelected = selectedAnimal?.id === animal.id;

        const speciesCodeMap: Record<string, string> = {
          HORSE: 'ЖЫЛ',
          CAMEL: 'ТҮЙ',
          CATTLE: 'СИЫ',
          SHEEP: 'ҚОЙ',
          GOAT: 'ЕШК',
        };
        const speciesLabel = speciesCodeMap[animal.species] || 'МРС';

        let marker = markersRef.current[animal.id];

        if (!marker) {
          const el = document.createElement('div');
          el.className = 'cursor-pointer select-none';

          el.innerHTML = `
            <div class="relative group flex flex-col items-center">
              <div class="w-9 h-9 rounded-md flex items-center justify-center font-mono font-bold text-xs shadow-lg border transition-all ${
                isBreached
                  ? 'bg-rose-600 border-rose-300 text-white animate-pulse'
                  : 'bg-slate-900 border-emerald-500 text-emerald-400'
              } ${isSelected ? 'ring-2 ring-amber-400 scale-110' : ''}">
                ${speciesLabel}
              </div>
              <div class="mt-1 bg-slate-950 text-slate-200 text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-800 whitespace-nowrap flex items-center gap-1 shadow">
                <span class="${isBreached ? 'text-rose-400 font-bold' : 'text-slate-400'}">${animal.name}</span>
              </div>
            </div>
          `;

          el.addEventListener('click', (e) => {
            if (isDrawing) return;
            e.stopPropagation();
            setSelectedAnimal(animal);
            map.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
          });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);

          markersRef.current[animal.id] = marker;
        } else {
          marker.setLngLat([lng, lat]);
          const el = marker.getElement();
          const badgeDiv = el.querySelector('.relative > div');
          if (badgeDiv) {
            badgeDiv.className = `w-9 h-9 rounded-md flex items-center justify-center font-mono font-bold text-xs shadow-lg border transition-all ${
              isBreached
                ? 'bg-rose-600 border-rose-300 text-white animate-pulse'
                : 'bg-slate-900 border-emerald-500 text-emerald-400'
            } ${isSelected ? 'ring-2 ring-amber-400 scale-110' : ''}`;
          }
        }
      });
    });
  }, [animals, selectedAnimal?.id, isDrawing]);

  // 5. Map Click Handler
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = async (e: any) => {
      const clickLng = parseFloat(e.lngLat.lng.toFixed(6));
      const clickLat = parseFloat(e.lngLat.lat.toFixed(6));

      if (isDrawing) {
        setDrawPoints((prev) => [...prev, [clickLng, clickLat]]);
        return;
      }

      if (!selectedAnimal) return;

      setIsSimulating(true);
      try {
        const payload = {
          animalId: selectedAnimal.id,
          latitude: clickLat,
          longitude: clickLng,
          battery: selectedAnimal.device?.battery || 90,
          accuracy: 3.0,
        };
        setLastRequestPayload({
          deviceId: selectedAnimal.device?.deviceId || 'QAM-0001',
          ...payload,
          timestamp: new Date().toISOString(),
        });

        const res = await ApiClient.injectTelemetry(payload);
        if (res.collarResponse) {
          setEsp32Response(res.collarResponse);
        }

        setStatusNotification(
          res.collarResponse?.vibrate
            ? 'Ошейник вышел за границу: ВИБРАЦИЯ АКТИВИРОВАНА'
            : 'Скот внутри пастбища: нормальный режим'
        );

        await fetchData();
      } catch (err: any) {
        console.error('Teleport error:', err);
      } finally {
        setIsSimulating(false);
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [selectedAnimal?.id, isDrawing]);

  // 6. Draw Preview on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const sourceId = 'draw-preview-source';
    const lineLayerId = 'draw-preview-line';
    const pointLayerId = 'draw-preview-points';

    if (drawPoints.length === 0) {
      if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId);
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    const geojsonData: any = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: drawPoints,
          },
        },
        ...drawPoints.map((pt) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pt },
        })),
      ],
    };

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'geojson', data: geojsonData });

      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2.5,
          'line-dasharray': [2, 1],
        },
      });

      map.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    } else {
      map.getSource(sourceId).setData(geojsonData);
    }
  }, [drawPoints]);

  // Quick action: breach
  const handleSimulateBreach = async () => {
    if (!selectedAnimal) return;
    setIsSimulating(true);
    try {
      const res = await ApiClient.simulateBreach(selectedAnimal.id);
      if (res.collarResponse) setEsp32Response(res.collarResponse);
      setStatusNotification('Имитация побега: ошейник включил вибрацию 3000 мс');
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Quick action: return
  const handleSimulateReturn = async () => {
    if (!selectedAnimal) return;
    setIsSimulating(true);
    try {
      const res = await ApiClient.simulateReturn(selectedAnimal.id);
      if (res.collarResponse) setEsp32Response(res.collarResponse);
      setStatusNotification('Скот возвращен в загон: вибрация выключена');
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Manual Coordinate Injection from site
  const handleApplyManualCoordinates = async () => {
    if (!selectedAnimal) return;
    const latNum = parseFloat(manualLat);
    const lngNum = parseFloat(manualLng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      alert('Введите корректные числовые координаты (например: 43.6501 и 51.1572)');
      return;
    }
    setIsSimulating(true);
    try {
      const res = await ApiClient.injectTelemetry({
        animalId: selectedAnimal.id,
        latitude: latNum,
        longitude: lngNum,
        battery: selectedAnimal.device?.battery || 90,
        accuracy: 3.0,
      });
      if (res.collarResponse) setEsp32Response(res.collarResponse);
      setStatusNotification(
        res.collarResponse?.vibrate
          ? `🚨 Точка [${latNum}, ${lngNum}] вне зоны: СКОТ СБЕЖАЛ! На ESP32 включен баззер.`
          : `✅ Точка [${latNum}, ${lngNum}] в зоне: скот в безопасности. Баззер выключен.`
      );
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo({ center: [lngNum, latNum], zoom: 15, duration: 600 });
      }
      await fetchData();
    } catch (err: any) {
      alert(`Ошибка применения координат: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Save Drawn Geofence
  const handleSaveGeofence = async () => {
    if (drawPoints.length < 3 || !newGeofenceName.trim()) return;
    setSavingGeofence(true);
    try {
      const closedCoordinates = [...drawPoints, drawPoints[0]];
      const payload = {
        name: newGeofenceName.trim(),
        description: newGeofenceDesc.trim() || undefined,
        color: newGeofenceColor,
        polygonJson: {
          type: 'Polygon',
          coordinates: [closedCoordinates],
        },
        animalIds: animals.map((a) => a.id),
      };

      const created = await ApiClient.createGeofence(payload);
      setStatusNotification(`Пастбище «${created.name}» создано и привязано к стаду`);
      setIsSaveModalOpen(false);
      setIsDrawing(false);
      setDrawPoints([]);
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      setSavingGeofence(false);
    }
  };

  const handleDeleteGeofence = async (id: string, name: string) => {
    if (!confirm(`Удалить пастбище «${name}»?`)) return;
    try {
      await ApiClient.deleteGeofence(id);
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    }
  };

  const copyJsonResponse = () => {
    if (!esp32Response) return;
    navigator.clipboard.writeText(JSON.stringify(esp32Response, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isVibrating = esp32Response?.vibrate || selectedAnimal?.isOutsideGeofence;

  return (
    <div className="relative flex-1 flex flex-col h-full bg-slate-950 text-slate-100 font-sans">
      {/* 1. TOP CONTROL BAR */}
      <div className="h-14 bg-slate-950 border-b border-slate-800 px-4 flex items-center justify-between shrink-0 z-30">
        {/* Left: Animal tabs */}
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <span className="text-[11px] font-mono uppercase text-slate-400 shrink-0">Стадо:</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {animals.map((a) => {
              const isSelected = selectedAnimal?.id === a.id;
              const isBreach = a.isOutsideGeofence;
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    if (isDrawing) return;
                    setSelectedAnimal(a);
                    if (mapInstanceRef.current && a.lastLatitude) {
                      mapInstanceRef.current.flyTo({
                        center: [a.lastLongitude, a.lastLatitude],
                        zoom: 15,
                        duration: 600,
                      });
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                    isSelected
                      ? isBreach
                        ? 'bg-rose-600 text-white font-bold shadow-sm'
                        : 'bg-emerald-600 text-white font-bold shadow-sm'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  <span>{a.name}</span>
                  {isBreach && <AlertTriangle className="w-3 h-3 text-rose-200" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: Live Collar Status */}
        <div className="hidden lg:flex items-center gap-3">
          {isVibrating ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono">
              <Zap className="w-3.5 h-3.5 fill-current animate-pulse text-rose-400" />
              <span>ВЫХОД ЗА ЗОНУ • ВИБРАЦИЯ 3000 мс</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>ВНУТРИ ПАСТБИЩА • НОРМА</span>
            </div>
          )}
        </div>

        {/* Right: Quick Test Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSimulateReturn}
            disabled={isSimulating || !selectedAnimal}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 rounded-md text-xs font-mono transition-colors disabled:opacity-40"
            title="Переместить скот внутрь геозоны"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Внутрь зоны</span>
          </button>

          <button
            onClick={handleSimulateBreach}
            disabled={isSimulating || !selectedAnimal}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-rose-400 border border-rose-500/30 rounded-md text-xs font-mono transition-colors disabled:opacity-40"
            title="Вывести скот за пределы (активирует вибромотор)"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span className="hidden sm:inline">Побег (Тест)</span>
          </button>

          {!isDrawing ? (
            <button
              onClick={() => {
                setIsDrawing(true);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-md text-xs font-mono transition-colors"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Нарисовать геозону</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDrawing(false);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-mono"
            >
              <X className="w-3.5 h-3.5" />
              <span>Отмена</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. MAP & TELEMETRY WORKSPACE */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Map Canvas */}
        <div
          ref={mapContainerRef}
          className={`flex-1 w-full h-full relative ${isDrawing ? 'cursor-crosshair' : 'cursor-pointer'}`}
        />

        {/* Floating Tooltip */}
        {!isDrawing && selectedAnimal && (
          <div className="absolute top-3 left-3 z-20 pointer-events-none">
            <div className="bg-slate-950/90 backdrop-blur-sm px-2.5 py-1 rounded-md border border-slate-800 text-slate-300 text-xs font-mono flex items-center gap-2 shadow">
              <MousePointerClick className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Кликните по карте, чтобы переместить животное</span>
            </div>
          </div>
        )}

        {/* Drawing Controls Floating Banner */}
        {isDrawing && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md w-full px-4">
            <div className="bg-slate-950/95 backdrop-blur-sm rounded-md p-3 text-white shadow-xl border border-amber-500/50 flex items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-amber-400 font-bold">Разметка границы пастбища</div>
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

        {/* Status Toast */}
        {statusNotification && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 max-w-lg w-full px-4">
            <div className="bg-slate-900 text-slate-200 rounded-md p-2.5 shadow-xl border border-slate-700 flex items-center justify-between gap-3 text-xs font-mono">
              <span>{statusNotification}</span>
              <button
                onClick={() => setStatusNotification(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* 3. DOCKED RIGHT PANEL: TELEMETRY & HARDWARE MONITOR */}
        <div className="w-80 md:w-96 bg-slate-950 border-l border-slate-800 p-4 flex flex-col shrink-0 z-20 overflow-y-auto font-mono text-xs">
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                ESP32 Ingestion Gateway
              </span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              HTTP 200 OK
            </span>
          </div>

          {/* Active Collar Status Card */}
          <div className="my-3 p-3 rounded-md bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">
                {selectedAnimal ? `${selectedAnimal.name} (${selectedAnimal.tagNumber})` : 'Ошейник'}
              </span>
              <span className="text-[11px] text-emerald-400">
                {selectedAnimal?.device?.deviceId || 'QAM-0001'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Вибромотор (GPIO):</span>
                <span
                  className={`font-bold flex items-center gap-1 mt-0.5 ${
                    isVibrating ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
                  }`}
                >
                  <Zap className="w-3 h-3 fill-current" />
                  {isVibrating ? 'АКТИВЕН (3000 мс)' : 'ВЫКЛЮЧЕН'}
                </span>
              </div>

              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Зуммер (Piezo):</span>
                <span
                  className={`font-bold flex items-center gap-1 mt-0.5 ${
                    isVibrating ? 'text-amber-400' : 'text-slate-400'
                  }`}
                >
                  {isVibrating ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  {isVibrating ? 'СИГНАЛ ВКЛ' : 'ВЫКЛ'}
                </span>
              </div>
            </div>

            <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Battery className="w-3.5 h-3.5 text-emerald-400" />
                {selectedAnimal?.device?.battery || 90}% заряд
              </span>
              <span className="flex items-center gap-1">
                <Signal className="w-3.5 h-3.5 text-slate-400" />
                -75 dBm (LTE)
              </span>
            </div>
          </div>

          {/* Manual Coordinate Control (Test without physical ESP32) */}
          <div className="mb-3 p-3 rounded-md bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-slate-300 uppercase">Ручной ввод GPS координат:</span>
              <span className="text-[10px] text-amber-400">Тест без ESP</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">Широта (Lat):</label>
                <input
                  type="text"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-xs text-slate-200 outline-none focus:border-emerald-500 font-mono"
                  placeholder="43.6501"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">Долгота (Lng):</label>
                <input
                  type="text"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-xs text-slate-200 outline-none focus:border-emerald-500 font-mono"
                  placeholder="51.1572"
                />
              </div>
            </div>

            <button
              onClick={handleApplyManualCoordinates}
              disabled={isSimulating || !selectedAnimal}
              className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs font-mono transition-colors disabled:opacity-40"
            >
              {isSimulating ? 'Проверка зоны...' : 'Применить координаты к скоту'}
            </button>
          </div>

          {/* JSON Telemetry Response Box */}
          <div className="flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-1 text-[11px]">
              <span className="text-slate-400">Ответ сервера (POST /telemetry):</span>
              <button
                onClick={copyJsonResponse}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 transition-colors"
                title="Скопировать JSON"
              >
                {copied ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Скопировано' : 'JSON'}</span>
              </button>
            </div>

            <div className="flex-1 p-2.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] leading-relaxed text-emerald-400 overflow-x-auto select-all font-mono">
              <pre>{JSON.stringify(esp32Response || {}, null, 2)}</pre>
            </div>
          </div>

          {/* Pastures List */}
          {geofences.length > 0 && (
            <div className="mt-3 pt-2.5 border-t border-slate-800 text-xs">
              <div className="flex items-center justify-between mb-1.5 text-[11px]">
                <span className="text-slate-400 uppercase font-mono">Геозоны ({geofences.length}):</span>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {geofences.map((gf) => (
                  <div
                    key={gf.id}
                    className="flex items-center justify-between bg-slate-900 px-2 py-1 rounded border border-slate-800 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: gf.color || '#10b981' }}
                      />
                      <span className="text-slate-200 truncate">{gf.name}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteGeofence(gf.id, gf.name)}
                      className="text-slate-400 hover:text-rose-400 p-0.5"
                      title="Удалить пастбище"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SAVE GEOFENCE MODAL */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-md max-w-sm w-full p-4 shadow-2xl border border-slate-800 space-y-3 text-white text-xs font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <Trees className="w-4 h-4" />
                <span>Новая геозона пастбища</span>
              </div>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Название пастбища *</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  placeholder="Пастбище (Загон №1)"
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Цвет границы</label>
                <div className="flex items-center gap-2">
                  {['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewGeofenceColor(col)}
                      className={`w-6 h-6 rounded border transition-transform ${
                        newGeofenceColor === col ? 'scale-110 border-white ring-1 ring-white' : 'border-slate-700'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-white rounded"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSaveGeofence}
                  disabled={savingGeofence}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold disabled:opacity-40"
                >
                  {savingGeofence ? 'Сохранение...' : 'Сохранить геозону'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveMapPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-slate-400 text-xs font-mono">
          Инициализация гео-карты...
        </div>
      }
    >
      <LiveMapContent />
    </Suspense>
  );
}
