'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiClient } from '../../../lib/api';
import {
  ShieldAlert,
  AlertTriangle,
  BatteryWarning,
  CheckCircle2,
  Clock,
  Compass,
  MapPin,
  Check,
  RefreshCw,
} from 'lucide-react';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const loadAlerts = async () => {
    try {
      const data = await ApiClient.listAlerts();
      setAlerts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const handleResolve = async (id: string) => {
    try {
      await ApiClient.resolveAlert(id);
      loadAlerts();
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = alerts.filter((a) => {
    if (statusFilter === 'ACTIVE') return a.status === 'ACTIVE';
    if (statusFilter === 'RESOLVED') return a.status === 'RESOLVED';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Центр оповещений и тревог</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Фиксация инцидентов выхода за геозоны, разрядки батарей и потери GSM-связи
          </p>
        </div>
        <button
          onClick={loadAlerts}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Обновить</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm w-fit text-xs">
        <button
          onClick={() => setStatusFilter('ALL')}
          className={`px-4 py-2 rounded-xl font-bold transition-colors ${
            statusFilter === 'ALL' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Все ({alerts.length})
        </button>
        <button
          onClick={() => setStatusFilter('ACTIVE')}
          className={`px-4 py-2 rounded-xl font-bold transition-colors ${
            statusFilter === 'ACTIVE' ? 'bg-red-600 text-white shadow-md shadow-red-950/20' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Активные ({alerts.filter((a) => a.status === 'ACTIVE').length})
        </button>
        <button
          onClick={() => setStatusFilter('RESOLVED')}
          className={`px-4 py-2 rounded-xl font-bold transition-colors ${
            statusFilter === 'RESOLVED' ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Решённые ({alerts.filter((a) => a.status === 'RESOLVED').length})
        </button>
      </div>

      {/* Alerts Feed */}
      <div className="space-y-3">
        {filtered.map((alert) => {
          const isActive = alert.status === 'ACTIVE';
          const isBreach = alert.type === 'GEOFENCE_BREACH';

          return (
            <div
              key={alert.id}
              className={`p-5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                isActive
                  ? 'bg-red-50/70 border-red-300 ring-1 ring-red-400/30 shadow-md'
                  : 'bg-white border-slate-200 shadow-sm opacity-90'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    isActive ? 'bg-red-600 text-white shadow-md shadow-red-900/30' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isBreach ? <AlertTriangle className="w-5 h-5" /> : <BatteryWarning className="w-5 h-5" />}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-wide ${
                        isActive ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {alert.type}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3" />
                      {new Date(alert.createdAt).toLocaleString('ru-RU')}
                    </span>
                  </div>

                  <h3 className={`font-bold text-sm ${isActive ? 'text-red-950 font-black' : 'text-slate-800'}`}>
                    {alert.message}
                  </h3>

                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    {alert.animal && (
                      <span className="flex items-center gap-1 font-semibold text-slate-700">
                        <Compass className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{alert.animal.name} ({alert.animal.species})</span>
                      </span>
                    )}
                    {alert.latitude && (
                      <span className="font-mono text-[11px] text-slate-500">
                        {alert.latitude.toFixed(4)}°N, {alert.longitude.toFixed(4)}°E
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                {alert.animalId && (
                  <Link
                    href={`/map?animalId=${alert.animalId}`}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors shadow-sm"
                  >
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                    <span>На карте</span>
                  </Link>
                )}

                {isActive && (
                  <button
                    onClick={() => handleResolve(alert.id)}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors shadow-sm"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Подтвердить и закрыть</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="font-bold text-base text-slate-800">Все чисто!</h3>
            <p className="text-xs text-slate-500 mt-1">В выбранной категории нет тревог.</p>
          </div>
        )}
      </div>
    </div>
  );
}

