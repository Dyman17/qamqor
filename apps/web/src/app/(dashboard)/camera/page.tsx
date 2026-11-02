'use client';

import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../../lib/api';
import {
  Camera,
  RefreshCw,
  Clock,
  Compass,
  Radio,
  Sliders,
  Send,
  Eye,
  CheckCircle2,
} from 'lucide-react';

export default function CameraPage() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [animals, setAnimals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [requestState, setRequestState] = useState<{ status: 'idle' | 'pending' | 'success' | 'error'; message?: string }>({
    status: 'idle',
  });
  const [activeSnapshot, setActiveSnapshot] = useState<any | null>(null);

  const loadData = async () => {
    try {
      const [snaps, devs, anms] = await Promise.all([
        ApiClient.listSnapshots(),
        ApiClient.listDevices(),
        ApiClient.listAnimals(),
      ]);
      setSnapshots(snaps);
      setDevices(devs);
      setAnimals(anms);
      if (devs.length > 0 && !selectedDevice) {
        setSelectedDevice(devs[0].deviceId);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRequestPhoto = async () => {
    if (!selectedDevice) return;
    setRequestState({ status: 'pending', message: 'Отправка команды в очередь...' });
    try {
      const res = await ApiClient.requestPhoto(selectedDevice);
      setRequestState({
        status: 'success',
        message: `Команда поставлена в очередь (ID: ${res.commandId.slice(0, 8)}...). Камера сделает снимок при следующем включении.`,
      });
    } catch (e: any) {
      setRequestState({ status: 'error', message: e.message });
    }
  };

  const handleMockSnapshot = async () => {
    if (animals.length === 0) return;
    setRequestState({ status: 'pending', message: 'Генерация тестового кадра с ошейника...' });
    try {
      await ApiClient.injectPhoto(animals[0].id);
      setRequestState({ status: 'success', message: 'Новый снимок с ошейника успешно получен и добавлен в галерею!' });
      loadData();
    } catch (e: any) {
      setRequestState({ status: 'error', message: e.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Камеры ошейников (ESP32-CAM)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Фотографии местности, визуальный контроль скота при побегах и по запросу фермера
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Обновить галерею</span>
        </button>
      </div>

      {/* Control Card: Order Snapshot */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h2 className="font-bold text-sm text-slate-900 flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-600" />
          <span>Запросить снимок с ошейника животного</span>
        </h2>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.deviceId}>
                {d.deviceId} • {d.animal ? `Животное: ${d.animal.name}` : 'Свободный'}
              </option>
            ))}
          </select>

          <button
            onClick={handleRequestPhoto}
            disabled={requestState.status === 'pending' || !selectedDevice}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Запросить снимок (Async Queue)</span>
          </button>

          <button
            onClick={handleMockSnapshot}
            disabled={requestState.status === 'pending'}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Смоделировать снимок камеры (Тест)</span>
          </button>
        </div>

        {/* Status Alert Banner */}
        {requestState.status !== 'idle' && (
          <div
            className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
              requestState.status === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : requestState.status === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200 animate-pulse'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{requestState.message}</span>
          </div>
        )}
      </div>

      {/* Snapshots Gallery */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-slate-800 flex items-center justify-between">
          <span>Снимки с ошейников</span>
          <span className="text-xs text-slate-400 font-normal">Всего кадров: {snapshots.length}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              onClick={() => setActiveSnapshot(snap)}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer group"
            >
              {/* Image Preview Container */}
              <div className="relative aspect-video bg-slate-900 overflow-hidden flex items-center justify-center">
                <img
                  src={snap.imageUrl.startsWith('http') ? snap.imageUrl : `http://localhost:4000${snap.imageUrl}`}
                  alt="Snapshot"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e: any) => {
                    e.target.src = 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=800&auto=format&fit=crop&q=60';
                  }}
                />
                <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur text-white text-[10px] font-mono font-bold">
                  {snap.deviceId}
                </div>
              </div>

              {/* Card Meta */}
              <div className="p-4 space-y-1.5 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-900">
                  <div className="flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{snap.animal?.name || 'Животное'}</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">{snap.trigger}</span>
                </div>

                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span className="flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {new Date(snap.capturedAt).toLocaleString('ru-RU')}
                  </span>
                  <span className="text-emerald-700 font-semibold group-hover:underline flex items-center gap-0.5">
                    <Eye className="w-3 h-3" /> Просмотр
                  </span>
                </div>
              </div>
            </div>
          ))}

          {snapshots.length === 0 && (
            <div className="col-span-full bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h4 className="font-bold text-slate-800">Снимков пока нет</h4>
              <p className="text-xs text-slate-500 mt-1">
                Нажмите «Смоделировать снимок камеры (Тест)», чтобы добавить первый кадр.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Snapshot Fullscreen Modal */}
      {activeSnapshot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl border border-slate-800">
            <div className="p-4 flex items-center justify-between border-b border-slate-800 text-white">
              <div>
                <div className="font-bold text-sm">Снимок с ошейника {activeSnapshot.deviceId}</div>
                <div className="text-xs text-slate-400">
                  {activeSnapshot.animal?.name} • {new Date(activeSnapshot.capturedAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <button
                onClick={() => setActiveSnapshot(null)}
                className="text-slate-400 hover:text-white px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-4 bg-black flex items-center justify-center">
              <img
                src={activeSnapshot.imageUrl.startsWith('http') ? activeSnapshot.imageUrl : `http://localhost:4000${activeSnapshot.imageUrl}`}
                alt="Full preview"
                className="max-h-[60vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

