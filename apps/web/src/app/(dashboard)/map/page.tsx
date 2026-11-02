'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiClient } from '../../../lib/api';
import {
  Compass,
  Filter,
  Search,
  Radio,
  Battery,
  AlertTriangle,
  RotateCcw,
  Camera,
  Layers,
  MapPin,
  ExternalLink,
  RefreshCw,
  Navigation,
  PenTool,
  Check,
  X,
  Undo2,
  Trash2,
  Trees,
  CheckCircle2,
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
  const [trackPoints, setTrackPoints] = useState<any[]>([]);
  const [showTrack, setShowTrack] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [cameraRequesting, setCameraRequesting] = useState(false);
  const [cameraFeedback, setCameraFeedback] = useState<string | null>(null);

  // ==========================================
  // GEOFENCE POLYGON DRAWING STATE
  // ==========================================
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<number[][]>([]); // Array of [lng, lat]
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newGeofenceName, setNewGeofenceName] = useState('Жайлау №2');
  const [newGeofenceDesc, setNewGeofenceDesc] = useState('Зона выпаса скота');
  const [newGeofenceColor, setNewGeofenceColor] = useState('#10b981');
  const [selectedAnimalIds, setSelectedAnimalIds] = useState<string[]>([]);
  const [savingGeofence, setSavingGeofence] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // 1. Load Data
  const fetchData = async () => {
    try {
      const [animalsData, geofencesData] = await Promise.all([
        ApiClient.listAnimals(),
        ApiClient.listGeofences(),
      ]);
      setAnimals(animalsData);
      setGeofences(geofencesData);

      if (urlAnimalId && !selectedAnimal) {
        const found = animalsData.find((a: any) => a.id === urlAnimalId);
        if (found) setSelectedAnimal(found);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 8000);
    return () => clearInterval(timer);
  }, []);

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

  // 3. Render Pastures Polygons on Map
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
            'line-width': 3,
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

  // 4. Update Animal Markers on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    import('maplibre-gl').then((maplibreglModule) => {
      const maplibregl = maplibreglModule.default;

      animals.forEach((animal) => {
        const lat = animal.lastLatitude || 43.6501;
        const lng = animal.lastLongitude || 51.1572;
        const isBreached = animal.isOutsideGeofence;

        let marker = markersRef.current[animal.id];

        if (!marker) {
          const el = document.createElement('div');
          el.className = 'cursor-pointer select-none';

          const speciesIcons: Record<string, string> = {
            HORSE: '🐎',
            CAMEL: '🐫',
            CATTLE: '🐄',
            SHEEP: '🐑',
            GOAT: '🐐',
          };
          const icon = speciesIcons[animal.species] || '📍';

          el.innerHTML = `
            <div class="relative group">
              <div class="w-10 h-10 rounded-full flex items-center justify-center text-lg shadow-xl border-2 transition-transform transform hover:scale-125 ${
                isBreached
                  ? 'bg-red-600 border-white text-white breach-pulse'
                  : 'bg-emerald-600 border-white text-white'
              }">
                ${icon}
              </div>
              <div class="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
                ${animal.name}
              </div>
            </div>
          `;

          el.addEventListener('click', (e) => {
            if (isDrawing) return; // Ignore animal click while in polygon drawing mode
            e.stopPropagation();
            setSelectedAnimal(animal);
            map.flyTo({ center: [lng, lat], zoom: 15, duration: 1000 });
          });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);

          markersRef.current[animal.id] = marker;
        } else {
          marker.setLngLat([lng, lat]);
        }
      });
    });
  }, [animals, isDrawing]);

  // ==========================================
  // 5. INTERACTIVE POLYGON DRAWING LOGIC
  // ==========================================

  // Map Click Handler for Drawing Mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: any) => {
      if (!isDrawing) return;
      const newPoint = [parseFloat(e.lngLat.lng.toFixed(6)), parseFloat(e.lngLat.lat.toFixed(6))];
      setDrawPoints((prev) => [...prev, newPoint]);
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [isDrawing]);

  // Update dynamic preview layers of drawn polygon on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const sourcePointsId = 'drawing-points-source';
    const sourceLineId = 'drawing-line-source';
    const sourcePolyId = 'drawing-poly-source';

    // Cleanup drawing layers
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

    // 1. Add Vertices Layer
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
        'circle-radius': 6,
        'circle-color': '#d97706',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // 2. Add Perimeter Line Layer
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

    // 3. Add Semi-Transparent Polygon Preview (if >= 3 points)
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
          'fill-opacity': 0.25,
        },
      });
    }
  }, [drawPoints, isDrawing, newGeofenceColor]);

  const startDrawingMode = () => {
    setSelectedAnimal(null);
    setDrawPoints([]);
    setIsDrawing(true);
    setSaveSuccessMessage(null);
  };

  const cancelDrawingMode = () => {
    setIsDrawing(false);
    setDrawPoints([]);
  };

  const undoLastPoint = () => {
    setDrawPoints((prev) => prev.slice(0, prev.length - 1));
  };

  const finishContour = () => {
    if (drawPoints.length < 3) return;
    // Pre-select all animals or keep current
    setSelectedAnimalIds(animals.map((a) => a.id));
    setIsSaveModalOpen(true);
  };

  const handleSaveGeofence = async () => {
    if (drawPoints.length < 3 || !newGeofenceName.trim()) return;
    setSavingGeofence(true);
    try {
      // GeoJSON requires closed linear ring (first point = last point)
      const closedCoordinates = [...drawPoints, drawPoints[0]];
      const payload = {
        name: newGeofenceName.trim(),
        description: newGeofenceDesc.trim() || undefined,
        color: newGeofenceColor,
        polygonJson: {
          type: 'Polygon',
          coordinates: [closedCoordinates],
        },
        animalIds: selectedAnimalIds,
      };

      const created = await ApiClient.createGeofence(payload);
      setSaveSuccessMessage(`Пастбище «${created.name}» успешно создано и закреплено за животными!`);
      setIsSaveModalOpen(false);
      setIsDrawing(false);
      setDrawPoints([]);

      // Refresh data to show new pasture polygon and assigned animals immediately
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка сохранения: ${e.message}`);
    } finally {
      setSavingGeofence(false);
    }
  };

  const handleDeleteGeofence = async (id: string, name: string) => {
    if (!confirm(`Удалить пастбище «${name}»? Животные будут откреплены.`)) return;
    try {
      await ApiClient.deleteGeofence(id);
      await fetchData();
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    }
  };

  // 6. Historical Track handling
  const handleToggleTrack = async () => {
    if (!selectedAnimal) return;
    if (showTrack) {
      setShowTrack(false);
      removeTrackFromMap();
      return;
    }

    try {
      const trackData = await ApiClient.getAnimalTrack(selectedAnimal.id, 100);
      setTrackPoints(trackData.points);
      setShowTrack(true);
      drawTrackOnMap(trackData.points);
    } catch (e) {
      console.error(e);
    }
  };

  const drawTrackOnMap = (points: any[]) => {
    const map = mapInstanceRef.current;
    if (!map || points.length === 0) return;

    const coordinates = points.map((p) => [p.longitude, p.latitude]);

    if (map.getSource('track-line-source')) {
      map.removeLayer('track-line-layer');
      map.removeSource('track-line-source');
    }

    map.addSource('track-line-source', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    });

    map.addLayer({
      id: 'track-line-layer',
      type: 'line',
      source: 'track-line-source',
      paint: {
        'line-color': '#f59e0b',
        'line-width': 4,
        'line-opacity': 0.85,
      },
    });
  };

  const removeTrackFromMap = () => {
    const map = mapInstanceRef.current;
    if (map && map.getSource('track-line-source')) {
      map.removeLayer('track-line-layer');
      map.removeSource('track-line-source');
    }
  };

  // 7. Request snapshot from collar camera
  const handleRequestCamera = async () => {
    if (!selectedAnimal?.device?.deviceId) return;
    setCameraRequesting(true);
    setCameraFeedback(null);
    try {
      const res = await ApiClient.requestPhoto(selectedAnimal.device.deviceId);
      setCameraFeedback(res.message);
    } catch (e: any) {
      setCameraFeedback(`Ошибка: ${e.message}`);
    } finally {
      setCameraRequesting(false);
    }
  };

  const filteredAnimals = animals.filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.tagNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSpecies = speciesFilter === 'ALL' || a.species === speciesFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'OUTSIDE' && a.isOutsideGeofence) ||
      (statusFilter === 'INSIDE' && !a.isOutsideGeofence);

    return matchesSearch && matchesSpecies && matchesStatus;
  });

  return (
    <div className="relative h-[calc(100vh-7rem)] -m-6 md:-m-8 flex overflow-hidden">
      {/* Left Sidebar Drawer: Flock List & Drawing Controls */}
      <div className="w-80 bg-white border-r border-slate-200 z-10 flex flex-col shrink-0 shadow-lg">
        {/* Draw pasture action button */}
        <div className="p-4 border-b border-slate-200 bg-emerald-950 text-white space-y-2">
          <div className="text-[10px] uppercase font-bold tracking-widest text-emerald-300">
            Виртуальные пастбища
          </div>
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm">Выделение безопасной зоны</h2>
          </div>
          {!isDrawing ? (
            <button
              onClick={startDrawingMode}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-xs transition-all shadow-md shadow-emerald-900/40"
            >
              <PenTool className="w-4 h-4" />
              <span>Нарисовать область на карте</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={finishContour}
                disabled={drawPoints.length < 3}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-bold text-xs transition-all disabled:opacity-40"
              >
                <Check className="w-4 h-4" />
                <span>Завершить ({drawPoints.length})</span>
              </button>
              <button
                onClick={undoLastPoint}
                disabled={drawPoints.length === 0}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs transition-colors disabled:opacity-40"
                title="Отменить последнюю точку"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={cancelDrawingMode}
                className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs transition-colors"
                title="Отмена рисования"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Existing Pastures Quick List */}
        {geofences.length > 0 && !isDrawing && (
          <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200 text-xs">
            <div className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">Активные пастбища:</div>
            <div className="space-y-1.5 max-h-24 overflow-y-auto">
              {geofences.map((gf) => (
                <div key={gf.id} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: gf.color || '#10b981' }}></span>
                    <span className="font-semibold text-slate-800 truncate">{gf.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteGeofence(gf.id, gf.name)}
                    className="text-slate-400 hover:text-red-600 p-1"
                    title="Удалить пастбище"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search & Filter Header */}
        <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/70">
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <Compass className="w-4 h-4 text-emerald-600" />
              <span>Скот на карте</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
              {filteredAnimals.length} из {animals.length}
            </span>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по кличке или бирке..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            {['ALL', 'HORSE', 'CAMEL', 'CATTLE', 'SHEEP'].map((sp) => (
              <button
                key={sp}
                onClick={() => setSpeciesFilter(sp)}
                className={`px-2 py-1 rounded-lg font-semibold shrink-0 transition-colors ${
                  speciesFilter === sp
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {sp === 'ALL' ? 'Все' : sp === 'HORSE' ? '🐎 Жылқы' : sp === 'CAMEL' ? '🐫 Түйе' : sp === 'CATTLE' ? '🐄 Сиыр' : '🐑 Қой'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[11px]">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`flex-1 py-1 rounded-md font-semibold ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              Все
            </button>
            <button
              onClick={() => setStatusFilter('OUTSIDE')}
              className={`flex-1 py-1 rounded-md font-semibold ${
                statusFilter === 'OUTSIDE' ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              🚨 Вне зоны
            </button>
            <button
              onClick={() => setStatusFilter('INSIDE')}
              className={`flex-1 py-1 rounded-md font-semibold ${
                statusFilter === 'INSIDE' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              В загоне
            </button>
          </div>
        </div>

        {/* Animals Scrollable List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
          {filteredAnimals.map((animal) => {
            const isBreach = animal.isOutsideGeofence;
            const isSelected = selectedAnimal?.id === animal.id;

            return (
              <div
                key={animal.id}
                onClick={() => {
                  if (isDrawing) return;
                  setSelectedAnimal(animal);
                  if (mapInstanceRef.current && animal.lastLatitude) {
                    mapInstanceRef.current.flyTo({
                      center: [animal.lastLongitude, animal.lastLatitude],
                      zoom: 15,
                    });
                  }
                }}
                className={`p-3 rounded-xl cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-emerald-50 border-2 border-emerald-500 shadow-sm'
                    : 'hover:bg-slate-50 border border-transparent'
                } ${isBreach && !isSelected ? 'bg-red-50/50 border-red-200' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                    <span>{animal.name}</span>
                    <span className="text-[10px] text-slate-400 font-normal">({animal.species})</span>
                  </div>
                  {isBreach ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-red-600 text-white animate-pulse">
                      ВНЕ ЗОНЫ
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                      В норме
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono text-[11px] font-semibold">{animal.tagNumber}</span>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Battery className={`w-3.5 h-3.5 ${animal.device?.battery <= 15 ? 'text-red-600 font-bold' : 'text-emerald-600'}`} />
                      <span className="text-[11px] font-medium">{animal.device?.battery || 90}%</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Map Container */}
      <div
        ref={mapContainerRef}
        className={`flex-1 w-full h-full relative ${isDrawing ? 'cursor-crosshair' : ''}`}
      />

      {/* Floating Active Drawing Instructions Banner (Top Center) */}
      {isDrawing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-lg w-full px-4 animate-in slide-in-from-top duration-200">
          <div className="bg-slate-900/95 backdrop-blur-md rounded-2xl p-4 text-white shadow-2xl border border-amber-500/50 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                <PenTool className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                  Режим выделения границы
                </div>
                <div className="text-xs text-slate-200 mt-0.5">
                  Кликайте по карте для точек контура. Поставлено точек:{' '}
                  <span className="font-bold font-mono text-amber-400">{drawPoints.length}</span> (мин. 3).
                </div>
              </div>
            </div>

            <button
              onClick={finishContour}
              disabled={drawPoints.length < 3}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-black text-xs transition-all shadow-md disabled:opacity-40"
            >
              Готово
            </button>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {saveSuccessMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-md w-full px-4 animate-in fade-in duration-300">
          <div className="bg-emerald-600 text-white rounded-2xl p-4 shadow-xl flex items-center justify-between gap-3 text-xs font-bold">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{saveSuccessMessage}</span>
            </div>
            <button onClick={() => setSaveSuccessMessage(null)} className="text-white/80 hover:text-white">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Floating Selected Animal Card */}
      {selectedAnimal && !isDrawing && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 max-w-lg w-full px-4 animate-in slide-in-from-bottom duration-300">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-2xl border border-slate-200/80">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold text-white shadow-md ${
                    selectedAnimal.isOutsideGeofence ? 'bg-red-600 ring-4 ring-red-200' : 'bg-emerald-700 ring-4 ring-emerald-100'
                  }`}
                >
                  {selectedAnimal.species === 'HORSE'
                    ? '🐎'
                    : selectedAnimal.species === 'CAMEL'
                    ? '🐫'
                    : selectedAnimal.species === 'CATTLE'
                    ? '🐄'
                    : '🐑'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-base text-slate-900">{selectedAnimal.name}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border">
                      {selectedAnimal.tagNumber}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    {selectedAnimal.lastLatitude
                      ? `${selectedAnimal.lastLatitude.toFixed(5)}°N, ${selectedAnimal.lastLongitude.toFixed(5)}°E`
                      : 'Координаты ожидаются'}
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedAnimal(null);
                  removeTrackFromMap();
                  setShowTrack(false);
                }}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <button
                onClick={handleToggleTrack}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-colors ${
                  showTrack
                    ? 'bg-amber-600 text-white shadow-md'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>{showTrack ? 'Скрыть трек' : 'Показать маршрут'}</span>
              </button>

              <button
                onClick={handleRequestCamera}
                disabled={cameraRequesting || !selectedAnimal.device}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                <Camera className="w-3.5 h-3.5 text-amber-400" />
                <span>{cameraRequesting ? 'Запрос...' : 'Снимок с ошейника'}</span>
              </button>
            </div>

            {cameraFeedback && (
              <div className="mt-2 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                {cameraFeedback}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Geofence Modal Dialog */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-base">
                <Trees className="w-5 h-5 text-emerald-600" />
                <span>Сохранение виртуального пастбища</span>
              </div>
              <button onClick={() => setIsSaveModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Название пастбища *</label>
                <input
                  type="text"
                  value={newGeofenceName}
                  onChange={(e) => setNewGeofenceName(e.target.value)}
                  placeholder="Например: Жайлау Көктем №2, Северный загон"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Цвет границы на карте</label>
                <div className="flex items-center gap-3">
                  {['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewGeofenceColor(col)}
                      className={`w-8 h-8 rounded-full border-2 transition-transform ${
                        newGeofenceColor === col ? 'scale-125 border-slate-900 shadow-md' : 'border-white'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                  <span className="text-slate-500 text-[11px] font-mono">{newGeofenceColor}</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Описание / Заметки</label>
                <input
                  type="text"
                  value={newGeofenceDesc}
                  onChange={(e) => setNewGeofenceDesc(e.target.value)}
                  placeholder="Водопой, свежая трава, охраняемая территория"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none"
                />
              </div>

              {/* Assign Animals Checklist */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-700">Закрепить животных за этой границей:</label>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedAnimalIds.length === animals.length) {
                        setSelectedAnimalIds([]);
                      } else {
                        setSelectedAnimalIds(animals.map((a) => a.id));
                      }
                    }}
                    className="text-emerald-700 hover:underline font-semibold"
                  >
                    {selectedAnimalIds.length === animals.length ? 'Снять всех' : 'Выбрать всех'}
                  </button>
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                  {animals.map((a) => {
                    const isChecked = selectedAnimalIds.includes(a.id);
                    return (
                      <label
                        key={a.id}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                          isChecked ? 'bg-emerald-100/70 text-emerald-950 font-bold' : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAnimalIds([...selectedAnimalIds, a.id]);
                              } else {
                                setSelectedAnimalIds(selectedAnimalIds.filter((id) => id !== a.id));
                              }
                            }}
                            className="accent-emerald-700 w-4 h-4 rounded"
                          />
                          <span>
                            {a.name} ({a.species})
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">{a.tagNumber}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSaveGeofence}
                  disabled={savingGeofence}
                  className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold shadow-md shadow-emerald-900/30 transition-all disabled:opacity-50"
                >
                  {savingGeofence ? 'Сохранение...' : '💾 Сохранить и активировать'}
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
