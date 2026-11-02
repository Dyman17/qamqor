'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiClient } from '../../../lib/api';
import {
  Radio,
  Plus,
  Battery,
  BatteryWarning,
  Signal,
  Cpu,
  MapPin,
  Clock,
  Compass,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export default function DevicesPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadDevices = async () => {
    try {
      const data = await ApiClient.listDevices();
      setDevices(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeviceId.trim()) {
      setFormError('Укажите идентификатор устройства (например, QAM-0005)');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await ApiClient.registerDevice({ deviceId: newDeviceId.trim().toUpperCase() });
      setIsModalOpen(false);
      setNewDeviceId('');
      loadDevices();
    } catch (err: any) {
      setFormError(err.message || 'Ошибка регистрации ошейника');
    } finally {
      setSubmitting(false);
    }
  };

  const total = devices.length;
  const online = devices.filter((d) => d.status === 'ONLINE').length;
  const lowBattery = devices.filter((d) => d.battery <= 15).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Смарт-ошейники ESP32</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Управление парком GPS/LTE ошейников, заряд батарей и качество связи в степи
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Зарегистрировать ошейник</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs uppercase font-bold text-slate-400">Всего ошейников</div>
            <div className="text-3xl font-black text-slate-900 mt-1">{total}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
            <Radio className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs uppercase font-bold text-emerald-600">На связи (Online)</div>
            <div className="text-3xl font-black text-emerald-700 mt-1">{online}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs uppercase font-bold text-amber-600">Низкий заряд (&le;15%)</div>
            <div className="text-3xl font-black text-amber-800 mt-1">{lowBattery}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
            <BatteryWarning className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Collars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {devices.map((device) => {
          const battery = device.battery ?? 100;
          const isLow = battery <= 15;
          const animal = device.animal;

          return (
            <div
              key={device.id}
              className={`bg-white rounded-2xl border p-5 shadow-sm space-y-4 transition-all hover:shadow-md ${
                isLow ? 'border-amber-300 ring-1 ring-amber-400/30' : 'border-slate-200'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-base text-slate-900">{device.deviceId}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        device.status === 'ONLINE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {device.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Cpu className="w-3 h-3" />
                    <span>FW v{device.firmwareVersion || '1.0.0'}</span>
                  </div>
                </div>

                {/* Battery percentage badge */}
                <div
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold ${
                    isLow ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-800'
                  }`}
                >
                  <Battery className="w-4 h-4" />
                  <span>{battery}%</span>
                </div>
              </div>

              {/* Battery Progress Bar */}
              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full ${isLow ? 'bg-red-500' : battery <= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${battery}%` }}
                ></div>
              </div>

              {/* Attached Animal Info */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400">Привязанное животное</div>
                {animal ? (
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <div className="flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{animal.name}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">{animal.tagNumber}</span>
                  </div>
                ) : (
                  <div className="text-slate-400 italic">Свободный ошейник (на складе)</div>
                )}
              </div>

              {/* Footer info */}
              <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                <div className="flex items-center gap-1">
                  <Signal className="w-3.5 h-3.5 text-slate-400" />
                  <span>{device.signal ? `${device.signal} dBm` : '-72 dBm (LTE)'}</span>
                </div>
                {animal && (
                  <Link
                    href={`/map?animalId=${animal.id}`}
                    className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Карта</span>
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Register Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">Регистрация ошейника</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                {formError}
              </div>
            )}

            <form onSubmit={handleRegisterDevice} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Идентификатор ошейника (Device ID) *</label>
                <input
                  type="text"
                  value={newDeviceId}
                  onChange={(e) => setNewDeviceId(e.target.value)}
                  placeholder="Например: QAM-0005"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-bold"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Уникальный секретный ключ для связи по HTTPS будет сгенерирован автоматически.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Создание...' : 'Зарегистрировать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

