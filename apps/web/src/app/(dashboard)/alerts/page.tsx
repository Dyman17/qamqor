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
  Zap,
} from 'lucide-react';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'RESOLVED'>('ALL');

  const loadAlerts = async () => {
    try {
      const data = await ApiClient.listAlerts();
      setAlerts(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 10000);
    return () => clearInterval(interval);
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
    <div className="flex-1 flex flex-col p-4 md:p-6 space-y-4 bg-slate-950 text-slate-100 font-sans overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-500" />
            <span>Журнал сработок и тревог</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            Автоматическая фиксация выхода за границы пастбищ, разрядки батареи и отклика ошейников
          </p>
        </div>
        <button
          onClick={loadAlerts}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-md text-xs font-mono transition-colors self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
          <span>Обновить</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 text-xs font-mono">
        <button
          onClick={() => setStatusFilter('ALL')}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            statusFilter === 'ALL'
              ? 'bg-slate-800 text-white font-bold border border-slate-700'
              : 'text-slate-400 hover:text-white bg-slate-900/50'
          }`}
        >
          Все ({alerts.length})
        </button>
        <button
          onClick={() => setStatusFilter('ACTIVE')}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            statusFilter === 'ACTIVE'
              ? 'bg-rose-950 text-rose-300 font-bold border border-rose-500/50'
              : 'text-slate-400 hover:text-white bg-slate-900/50'
          }`}
        >
          Активные ({alerts.filter((a) => a.status === 'ACTIVE').length})
        </button>
        <button
          onClick={() => setStatusFilter('RESOLVED')}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            statusFilter === 'RESOLVED'
              ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-500/50'
              : 'text-slate-400 hover:text-white bg-slate-900/50'
          }`}
        >
          Решённые ({alerts.filter((a) => a.status === 'RESOLVED').length})
        </button>
      </div>

      {/* Alerts Table / Cards */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs font-mono">
            Загрузка журнала событий...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs font-mono space-y-1">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
            <div className="text-slate-200 font-medium">Активных инцидентов нет</div>
            <div className="text-slate-400 text-[11px]">Все животные находятся внутри периметра пастбищ</div>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filtered.map((item) => {
              const isBreach = item.type === 'GEOFENCE_BREACH';
              const isActive = item.status === 'ACTIVE';

              return (
                <div
                  key={item.id}
                  className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono hover:bg-slate-850 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                        isBreach && isActive
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {isBreach ? <Zap className="w-4 h-4 fill-current" /> : <AlertTriangle className="w-4 h-4" />}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{item.title}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                            isActive
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isActive ? 'АКТИВНА' : 'РЕШЕНО'}
                        </span>
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5">{item.message}</p>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {new Date(item.createdAt).toLocaleString('ru-RU')}
                        </span>
                        {item.animal && (
                          <span className="text-slate-300 font-medium">
                            Скот: {item.animal.name} ({item.animal.tagNumber})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                    {item.animal?.id && (
                      <Link
                        href={`/map?animalId=${item.animal.id}`}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-mono transition-colors"
                      >
                        Показать на карте
                      </Link>
                    )}
                    {isActive && (
                      <button
                        onClick={() => handleResolve(item.id)}
                        className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 rounded text-xs font-mono transition-colors"
                      >
                        Квитировать
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
