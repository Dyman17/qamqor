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
  Zap,
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
      setAnimals(data || []);
      if (data && data.length > 0 && !selectedAnimalId) {
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

      const collar = res.collarResponse;
      setStatusMessage({
        type: 'success',
        text: collar?.vibrate
          ? 'Телеметрия принята: ВЫХОД ЗА ПЕРИМЕТР (активирован вибромотор 3000 мс)'
          : 'Телеметрия принята: скот внутри пастбища (нормальный режим)',
      });
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
      setStatusMessage({
        type: 'success',
        text: 'Имитация побега: координаты вынесены за границу, вибромотор ошейника включен!',
      });
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
      setStatusMessage({
        type: 'success',
        text: 'Скот возвращен в периметр: вибромотор выключен, интервал 300с.',
      });
      onDataChanged?.();
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 rounded-md max-w-md w-full shadow-2xl border border-slate-800 overflow-hidden font-mono text-xs text-slate-100">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <div>
              <div className="font-bold text-xs uppercase tracking-wider text-slate-200">
                Эмулятор сигналов ошейника
              </div>
              <div className="text-[10px] text-slate-400 font-normal">
                Тестирование реакции сервера и вибромотора
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-2.5 rounded text-xs flex items-center gap-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Animal selection */}
          <div>
            <label className="block text-[11px] text-slate-400 uppercase mb-1">
              Выберите животное:
            </label>
            <select
              value={selectedAnimalId}
              onChange={(e) => handleAnimalSelect(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-amber-400 text-xs"
            >
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.species}] {a.name} ({a.tagNumber}) • Ошейник {a.device?.deviceId || 'нет'}
                </option>
              ))}
            </select>
          </div>

          {/* Quick 1-Click Simulation Buttons */}
          <div className="space-y-1.5">
            <div className="text-[10px] text-slate-400 uppercase">Сценарии тестирования:</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleSimulateBreach}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-bold transition-colors disabled:opacity-40"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Имитация побега</span>
              </button>
              <button
                onClick={handleSimulateReturn}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-colors disabled:opacity-40"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Вернуть в загон</span>
              </button>
            </div>
          </div>

          {/* Manual coordinate inputs */}
          <div className="border-t border-slate-800 pt-3 space-y-2.5">
            <div className="text-[10px] text-slate-400 uppercase">Ручной ввод координат GPS:</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">Широта (Lat):</label>
                <input
                  type="text"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs focus:border-amber-400 outline-none"
                  placeholder="43.6501"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">Долгота (Lng):</label>
                <input
                  type="text"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs focus:border-amber-400 outline-none"
                  placeholder="51.1572"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                <span>Батарея:</span>
                <span className={battery <= 15 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                  {battery}%
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                value={battery}
                onChange={(e) => setBattery(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            <button
              onClick={handleManualInject}
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{loading ? 'Отправка...' : 'Отправить телеметрию в систему'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
