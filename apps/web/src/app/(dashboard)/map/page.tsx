'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiClient } from '../../../lib/api';
import {
  Compass,
  Radio,
  Battery,
  AlertTriangle,
  RotateCcw,
  Layers,
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

  // Geofence Polygon Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]); // Array of [lng, lat]
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('Жайлау №2');
  const [newGeofenceDesc, setNewGeofenceDesc] = useState('Зона безопасного выпаса');
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
      setAnimals(animalsData);
      setGeofences(geofencesData);

      // Default select first animal or matched from URL
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

  // Update mock response state whenever selected animal changes
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
          ? '🚨 GEOFENCE_BREACH: Скот вышел за пределы пастбища! Включена вибрация ошейника.'
          : '✅ Внутри границ пастбища. Вибрация выключена.',
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
            'fill-opacity': 0.22,
          },
        });

        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': gf.color || '#10b981',
            'line-width': 3.5,
            'line-dasharray': [2, 1],
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

  // 4. Update Animal Markers
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

        let marker = markersRef.current[animal.id];

        const speciesIcons: Record<string, string> = {
          HORSE: '🐎',
          CAMEL: '🐫',
          CATTLE: '🐄',
          SHEEP: '🐑',
          GOAT: '🐐',
        };
        const icon = speciesIcons[animal.species] || '📍';

        if (!marker) {
          const el = document.createElement('div');
          el.className = 'cursor-pointer select-none';

          el.innerHTML = `
            <div class="relative group">
              <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow-2xl border-2 transition-transform transform hover:scale-125 ${
                isBreached
                  ? 'bg-red-600 border-white text-white breach-pulse vibrate-active'
                  : 'bg-emerald-600 border-white text-white'
              } ${isSelected ? 'ring-4 ring-amber-400' : ''}">
                ${icon}
              </div>
              <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-slate-950/95 text-white text-[11px] font-bold px-2 py-0.5 rounded-md shadow whitespace-nowrap border border-slate-700 flex items-center gap-1">
                ${isBreached ? '<span class="text-amber-400">⚡</span>' : ''}
                ${animal.name}
              </div>
            </div>
          `;

          el.addEventListener('click', (e) => {
            if (isDrawing) return;
            e.stopPropagation();
            setSelectedAnimal(animal);
            map.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
          });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);

          markersRef.current[animal.id] = marker;
        } else {
          marker.setLngLat([lng, lat]);
          const el = marker.getElement();
          const innerDiv = el.querySelector('.relative > div');
          if (innerDiv) {
            innerDiv.className = `w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow-2xl border-2 transition-transform transform hover:scale-125 ${
              isBreached
                ? 'bg-red-600 border-white text-white breach-pulse vibrate-active'
                : 'bg-emerald-600 border-white text-white'
            } ${isSelected ? 'ring-4 ring-amber-400' : ''}`;
          }
        }
      });
    });
  }, [animals, selectedAnimal?.id, isDrawing]);

  // 5. Click on Map Handler (Drawing mode OR Teleport Animal to coordinate)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = async (e: any) => {
      const clickLng = parseFloat(e.lngLat.lng.toFixed(6));
      const clickLat = parseFloat(e.lngLat.lat.toFixed(6));

      // In drawing mode: add point to polygon vertices
      if (isDrawing) {
        setDrawPoints((prev) => [...prev, [clickLng, clickLat]]);
        return;
      }

      // Normal mode: Move selected animal to clicked point and test collar response!
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
            ? '⚡ Ошейник вышел за границу: ВИБРАЦИЯ АКТИВИРОВАНА!'
            : '✅ Ошейник внутри пастбища: Вибрация отключена.',
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
  }, [isDrawing, selectedAnimal]);

  // 6. Interactive Drawing Preview Layers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const sourcePointsId = 'drawing-points-source';
    const sourceLineId = 'drawing-line-source';
    const sourcePolyId = 'drawing-poly-source';

    const removeDrawingLayers = () => {
      if (map.getLayer('drawing-points-layer')) map.removeLayer('drawing-points-layer');
      if (map.getLayer('drawing-line-layer')) map.removeLayer('drawing-line-layer');
      if (map.getLayer('drawing-poly-layer')) map.removeLayer('drawing-poly-layer');
      if (map.getSource(sourcePointsId)) map.removeSource(sourcePointsId);
      if (map.getSource(sourceLineId)) map.removeSource(sourceLineId);
      if (map.getSource(sourcePolyId)) map.removeSource(sourcePolyId);
    };

    if (!isDrawing || drawPoints.length === 0) {
      removeDrawingLayers();
      return;
    }

    removeDrawingLayers();

    // Vertices
    map.addSource(sourcePointsId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: drawPoints.map((pt, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pt },
          properties: { index: i + 1 },
        })),
      },
    });

    map.addLayer({
      id: 'drawing-points-layer',
      type: 'circle',
      source: sourcePointsId,
      paint: {
        'circle-radius': 7,
        'circle-color': '#d97706',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Perimeter Line
    if (drawPoints.length >= 2) {
      map.addSource(sourceLineId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: drawPoints,
          },
        },
      });

      map.addLayer({
        id: 'drawing-line-layer',
        type: 'line',
        source: sourceLineId,
        paint: {
          'line-color': '#d97706',
          'line-width': 3,
          'line-dasharray': [2, 1],
        },
      });
    }

    // Semi-Transparent Polygon
    if (drawPoints.length >= 3) {
      const closedCoords = [...drawPoints, drawPoints[0]];
      map.addSource(sourcePolyId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [closedCoords],
          },
        },
      });

      map.addLayer({
        id: 'drawing-poly-layer',
        type: 'fill',
        source: sourcePolyId,
        paint: {
          'fill-color': newGeofenceColor || '#10b981',
          'fill-opacity': 0.28,
        },
      });
    }
  }, [drawPoints, isDrawing, newGeofenceColor]);

  // Quick Action: Simulate Breach
  const handleSimulateBreach = async () => {
    if (!selectedAnimal) return;
    setIsSimulating(true);
    try {
      const res = await ApiClient.simulateBreach(selectedAnimal.id);
      if (res.collarResponse) {
        setEsp32Response(res.collarResponse);
      }
      setStatusNotification('⚡ ТРЕВОГА: Скот выведен за пределы пастбища! Ошейник вибрирует.');
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Quick Action: Simulate Return
  const handleSimulateReturn = async () => {
    if (!selectedAnimal) return;
    setIsSimulating(true);
    try {
      const res = await ApiClient.simulateReturn(selectedAnimal.id);
      if (res.collarResponse) {
        setEsp32Response(res.collarResponse);
      }
      setStatusNotification('✅ Животное вернулось в загон. Вибрация ошейника выключена.');
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
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
        animalIds: animals.map((a) => a.id), // Bind all animals to the active pasture
      };

      const created = await ApiClient.createGeofence(payload);
      setStatusNotification(`Пастбище «${created.name}» создано и активировано для скота!`);
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
    <div className="relative h-[calc(100vh-7rem)] -m-6 md:-m-8 flex flex-col overflow-hidden bg-slate-900 text-slate-100 font-sans">
      {/* 1. TOP LIVE CONTROLS & VIBRATION STATUS BAR */}
      <div className="h-16 bg-slate-950 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 z-30 shadow-md">
        {/* Left: Livestock Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-bold text-slate-400">Животное:</span>
            <div className="flex items-center gap-1.5">
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
                        });
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? isBreach
                          ? 'bg-red-600 text-white ring-2 ring-red-400 shadow-lg shadow-red-900/50'
                          : 'bg-emerald-600 text-white ring-2 ring-emerald-400 shadow-lg shadow-emerald-900/50'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    <span>
                      {a.species === 'CAMEL'
                        ? '🐫'
                        : a.species === 'HORSE'
                        ? '🐎'
                        : a.species === 'CATTLE'
                        ? '🐄'
                        : '🐑'}
                    </span>
                    <span>{a.name}</span>
                    {isBreach && <span className="text-amber-300">⚡</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center: Live Collar Vibration Status Badge */}
        <div className="flex items-center gap-3">
          {isVibrating ? (
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-red-600 text-white font-black text-xs shadow-xl shadow-red-900/60 ring-2 ring-red-400 animate-pulse">
              <Zap className="w-4 h-4 fill-amber-300 text-amber-300 vibrate-active" />
              <div className="flex flex-col">
                <span className="tracking-wider uppercase">ВЫХОД ЗА ЗОНУ • ВИБРАЦИЯ ВКЛЮЧЕНА</span>
                <span className="text-[10px] font-normal text-red-100">
                  ESP32 мотор: 3000 мс | Зуммер: ВКЛ | Опрос: 60с
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-emerald-950/80 border border-emerald-600/50 text-emerald-400 font-bold text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <div className="flex flex-col">
                <span>ВНУТРИ ПАСТБИЩА • ВИБРАЦИЯ ВЫКЛ</span>
                <span className="text-[10px] font-normal text-slate-400">
                  ESP32 режим: Deep Sleep (300с)
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Quick Test Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSimulateReturn}
            disabled={isSimulating || !selectedAnimal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 shadow"
            title="Переместить внутрь геозоны (вибрация отключится)"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Внутрь зоны (Норма)</span>
          </button>

          <button
            onClick={handleSimulateBreach}
            disabled={isSimulating || !selectedAnimal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 shadow-lg shadow-red-900/40"
            title="Вывести за границу (активирует вибрацию)"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>Вывести за геозону (Вибрация!)</span>
          </button>

          {!isDrawing ? (
            <button
              onClick={() => {
                setIsDrawing(true);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all shadow"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Нарисовать геозону</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsDrawing(false);
                setDrawPoints([]);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold"
            >
              <X className="w-3.5 h-3.5" />
              <span>Отмена</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. MAIN WORKSPACE: MAP & LIVE ESP32 JSON INSPECTOR */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Map Container */}
        <div
          ref={mapContainerRef}
          className={`flex-1 w-full h-full relative ${isDrawing ? 'cursor-crosshair' : 'cursor-pointer'}`}
        />

        {/* Floating Tooltip: Click to move */}
        {!isDrawing && selectedAnimal && (
          <div className="absolute top-4 left-4 z-20 pointer-events-none">
            <div className="bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 text-slate-300 text-[11px] flex items-center gap-2 shadow-lg">
              <MousePointerClick className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Кликните в любое место на карте, чтобы мгновенно переместить животное</span>
            </div>
          </div>
        )}

        {/* Drawing Controls Floating Banner */}
        {isDrawing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-md w-full px-4 animate-in slide-in-from-top duration-200">
            <div className="bg-slate-950/95 backdrop-blur-md rounded-2xl p-4 text-white shadow-2xl border border-amber-500/60 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                  <PenTool className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-amber-300 uppercase">
                    Выделение границы
                  </div>
                  <div className="text-xs text-slate-300">
                    Кликайте точки на карте: <span className="font-mono font-bold text-amber-400">{drawPoints.length}</span> (мин. 3)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDrawPoints((prev) => prev.slice(0, prev.length - 1))}
                  disabled={drawPoints.length === 0}
                  className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs disabled:opacity-40"
                  title="Отменить точку"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (drawPoints.length >= 3) setIsSaveModalOpen(true);
                  }}
                  disabled={drawPoints.length < 3}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-black text-xs disabled:opacity-40 shadow"
                >
                  Завершить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Status Notification Toast */}
        {statusNotification && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 max-w-lg w-full px-4 animate-in fade-in duration-200">
            <div className="bg-slate-950 text-white rounded-2xl p-3.5 shadow-2xl border border-slate-700 flex items-center justify-between gap-3 text-xs font-bold">
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

        {/* 3. DOCKED RIGHT PANEL: LIVE ESP32 JSON VIEWER */}
        <div className="w-96 bg-slate-950/95 backdrop-blur-md border-l border-slate-800 p-4 flex flex-col shrink-0 z-20 overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                ESP32 Ingestion Gateway
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              200 OK
            </span>
          </div>

          {/* Active Collar Status Card */}
          <div className="my-3 p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">
                {selectedAnimal ? `${selectedAnimal.name} (${selectedAnimal.tagNumber})` : 'Ошейник'}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {selectedAnimal?.device?.deviceId || 'QAM-0001'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
              <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Вибратор (ESP32):</span>
                <span
                  className={`font-black text-xs flex items-center gap-1 ${
                    isVibrating ? 'text-red-400 vibrate-active' : 'text-emerald-400'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  {isVibrating ? 'АКТИВЕН (3 сек)' : 'ВЫКЛЮЧЕН'}
                </span>
              </div>

              <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Зуммер (Piezo):</span>
                <span
                  className={`font-black text-xs flex items-center gap-1 ${
                    isVibrating ? 'text-amber-400' : 'text-slate-500'
                  }`}
                >
                  {isVibrating ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  {isVibrating ? 'СИГНАЛ ВКЛ' : 'ВЫКЛ'}
                </span>
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>Батарея ошейника:</span>
              <span className="font-bold text-slate-200 flex items-center gap-1">
                <Battery className="w-3.5 h-3.5 text-emerald-400" />
                {selectedAnimal?.device?.battery || 90}%
              </span>
            </div>
          </div>

          {/* JSON Response Code Box */}
          <div className="flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-400">
                JSON ответ на ошейник (POST /telemetry):
              </span>
              <button
                onClick={copyJsonResponse}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 transition-colors"
                title="Скопировать JSON"
              >
                {copied ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
              </button>
            </div>

            <div className="flex-1 p-3 rounded-2xl bg-slate-900 border border-slate-800 font-mono text-[11px] leading-relaxed text-emerald-400 overflow-x-auto select-all">
              <pre>{JSON.stringify(esp32Response || {}, null, 2)}</pre>
            </div>
          </div>

          {/* Active Pastures mini list */}
          {geofences.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-800 text-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-bold text-slate-400">Размеченные геозоны:</span>
                <span className="text-[10px] text-emerald-400 font-bold">{geofences.length} активна</span>
              </div>
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {geofences.map((gf) => (
                  <div
                    key={gf.id}
                    className="flex items-center justify-between bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800 text-[11px]"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: gf.color || '#10b981' }}
                      ></span>
                      <span className="font-semibold text-slate-200 truncate">{gf.name}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteGeofence(gf.id, gf.name)}
                      className="text-slate-500 hover:text-red-400 p-1"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-800 space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <Trees className="w-5 h-5" />
                <span>Сохранение геозоны пастбища</span>
              </div>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Название пастбища *</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  placeholder="Например: Основное пастбище (Загон №1)"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl font-bold text-white outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Цвет границы на карте</label>
                <div className="flex items-center gap-3">
                  {['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewGeofenceColor(col)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        newGeofenceColor === col ? 'scale-125 border-white shadow-lg' : 'border-slate-700'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white rounded-xl font-bold"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSaveGeofence}
                  disabled={savingGeofence}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/40 transition-all disabled:opacity-50"
                >
                  {savingGeofence ? 'Сохранение...' : '💾 Сохранить и привязать скот'}
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
        <div className="h-full flex items-center justify-center text-slate-400 text-sm">
          Загрузка карты...
        </div>
      }
    >
      <LiveMapContent />
    </Suspense>
  );
}
