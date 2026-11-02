'use client';

import React, { useState, useEffect } from 'react';
import { ApiClient } from '../../lib/api';
import {
  X,
  Sliders,
  AlertTriangle,
  RotateCcw,
  Camera,
  Send,
  CheckCircle2,
  AlertCircle,
  Radio,
} from 'lucide-react';

interface MockControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
}

export function MockControlModal({ isOpen, onClose, onDataChanged }: MockControlModalProps) {
  const [animals, setAnimals] = useState<any[]>([]);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>('');
  const [lat, setLat] = useState<string>('43.6650');
  const [lng, setLng] = useState<string>('51.1750');
  const [battery, setBattery] = useState<number>(85);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadAnimals();
    }
  }, [isOpen]);

  const loadAnimals = async () => {
    try {
      const data = await ApiClient.listAnimals();
      setAnimals(data);
      if (data.length > 0 && !selectedAnimalId) {
        setSelectedAnimalId(data[0].id);
        if (data[0].lastLatitude) setLat(data[0].lastLatitude.toFixed(6));
        if (data[0].lastLongitude) setLng(data[0].lastLongitude.toFixed(6));
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleAnimalSelect = (id: string) => {
    setSelectedAnimalId(id);
    const animal = animals.find((a) => a.id === id);
    if (animal) {
      if (animal.lastLatitude) setLat(animal.lastLatitude.toFixed(6));
      if (animal.lastLongitude) setLng(animal.lastLongitude.toFixed(6));
      if (animal.device?.battery) setBattery(animal.device.battery);
    }
  };

  const handleManualInject = async () => {
    if (!selectedAnimalId) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await ApiClient.injectTelemetry({
        animalId: selectedAnimalId,
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        battery,
      });
      setStatusMessage({ type: 'success', text: res.message });
      onDataChanged?.();
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateBreach = async () => {
    if (!selectedAnimalId) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await ApiClient.simulateBreach(selectedAnimalId);
      setStatusMessage({ type: 'success', text: res.message });
      if (res.newState?.latitude) setLat(res.newState.latitude.toFixed(6));
      if (res.newState?.longitude) setLng(res.newState.longitude.toFixed(6));
      onDataChanged?.();
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateReturn = async () => {
    if (!selectedAnimalId) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await ApiClient.simulateReturn(selectedAnimalId);
      setStatusMessage({ type: 'success', text: res.message });
      if (res.newState?.latitude) setLat(res.newState.latitude.toFixed(6));
      if (res.newState?.longitude) setLng(res.newState.longitude.toFixed(6));
      onDataChanged?.();
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleInjectPhoto = async () => {
    if (!selectedAnimalId) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await ApiClient.injectPhoto(selectedAnimalId);
      setStatusMessage({ type: 'success', text: `📸 Снимок с ошейника успешно получен и сохранён!` });
      onDataChanged?.();
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-amber-200" />
            <div>
              <div className="font-bold text-base leading-tight">Эмулятор сигналов ошейника</div>
              <div className="text-xs text-amber-100">Тестирование сайта без физического ESP32</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-amber-100 hover:text-white rounded-lg hover:bg-amber-800/50">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Animal selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Выберите животное для теста:
            </label>
            <select
              value={selectedAnimalId}
              onChange={(e) => handleAnimalSelect(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.species}] {a.name} ({a.tagNumber}) • Ошейник {a.device?.deviceId || 'нет'} •{' '}
                  {a.isOutsideGeofence ? 'ВНЕ ПАСТБИЩА' : 'Внутри'}
                </option>
              ))}
            </select>
          </div>

          {/* Quick 1-Click Simulation Buttons */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Быстрые сценарии в 1 клик:
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={handleSimulateBreach}
                disabled={loading}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
              >
                <AlertTriangle className="w-4 h-4 text-red-200" />
                <span>Смоделировать побег</span>
              </button>
              <button
                onClick={handleSimulateReturn}
                disabled={loading}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4 text-emerald-200" />
                <span>Вернуть в загон</span>
              </button>
            </div>
            <button
              onClick={handleInjectPhoto}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
            >
              <Camera className="w-4 h-4 text-amber-400" />
              <span>Смоделировать снимок с камеры ошейника</span>
            </button>
          </div>

          {/* Manual coordinate inputs */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Или введите координаты вручную:
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Широта (Lat):</label>
                <input
                  type="text"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-medium focus:ring-2 focus:ring-amber-500 outline-none"
                  placeholder="43.6501"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Долгота (Lng):</label>
                <input
                  type="text"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-medium focus:ring-2 focus:ring-amber-500 outline-none"
                  placeholder="51.1572"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-semibold text-slate-600 mb-1">
                <span>Заряд батареи:</span>
                <span className={battery <= 15 ? 'text-red-600 font-bold' : 'text-emerald-700'}>{battery}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                value={battery}
                onChange={(e) => setBattery(parseInt(e.target.value, 10))}
                className="w-full accent-amber-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>5% (критический)</span>
                <span>15% (тревога)</span>
                <span>100% (полный)</span>
              </div>
            </div>

            <button
              onClick={handleManualInject}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{loading ? 'Отправка в API...' : 'Отправить эти данные в систему'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

