'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiClient } from '../../../lib/api';
import {
  Compass,
  Trees,
  AlertTriangle,
  Radio,
  BatteryWarning,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Clock,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const overview = await ApiClient.getOverview();
      setData(overview);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
          <div className="text-sm font-semibold">Загрузка данных хозяйства...</div>
        </div>
      </div>
    );
  }

  const stats = data?.stats || {
    totalAnimals: 0,
    insideGeofence: 0,
    outsideGeofence: 0,
    totalDevices: 0,
    onlineDevices: 0,
    lowBatteryDevices: 0,
    activeAlertsCount: 0,
  };

  const speciesNameMap: Record<string, string> = {
    HORSE: 'Жылқы (Лошади)',
    CAMEL: 'Түйе (Верблюды)',
    CATTLE: 'Сиыр (КРС)',
    SHEEP: 'Қой (Овцы)',
    GOAT: 'Ешкі (Козы)',
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 rounded-2xl p-6 text-white shadow-xl shadow-emerald-950/10">
        <div>
          <div className="text-xs uppercase font-bold tracking-widest text-emerald-300 mb-1">
            Оперативная панель фермера
          </div>
          <h1 className="text-2xl font-black tracking-tight">Мониторинг хозяйства</h1>
          <p className="text-sm text-emerald-100/80 mt-1 max-w-xl">
            Координаты обновляются в реальном времени. При выходе скота за границу ошейник автоматически переходит в частый режим связи.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleManualRefresh}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-700/60 hover:bg-emerald-600 rounded-xl text-xs font-semibold backdrop-blur transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Обновить</span>
          </button>
          <Link
            href="/map"
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-950/20"
          >
            <span>Открыть Live Map</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* 6 Key Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Total Animals */}
        <Link
          href="/animals"
          className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-emerald-500 transition-all group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Всего скота</span>
            <Compass className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-slate-900">{stats.totalAnimals}</div>
          <div className="text-[11px] text-slate-500 mt-1">Голов на учёте</div>
        </Link>

        {/* Inside Geofence */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">На пастбище</span>
            <Trees className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700">{stats.insideGeofence}</div>
          <div className="text-[11px] text-emerald-600/80 mt-1">В безопасной зоне</div>
        </div>

        {/* Outside Geofence (BREACH) */}
        <div
          className={`p-4 rounded-2xl border transition-all ${
            stats.outsideGeofence > 0
              ? 'bg-red-50 border-red-300 ring-2 ring-red-500/20 shadow-md'
              : 'bg-white border-slate-200/80 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${stats.outsideGeofence > 0 ? 'text-red-700' : 'text-slate-500'}`}>
              За границей
            </span>
            <AlertTriangle className={`w-4 h-4 ${stats.outsideGeofence > 0 ? 'text-red-600 animate-bounce' : 'text-slate-400'}`} />
          </div>
          <div className={`text-2xl font-black ${stats.outsideGeofence > 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {stats.outsideGeofence}
          </div>
          <div className={`text-[11px] mt-1 ${stats.outsideGeofence > 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
            {stats.outsideGeofence > 0 ? 'Требуют внимания!' : 'Побегов нет'}
          </div>
        </div>

        {/* Online Devices */}
        <Link
          href="/devices"
          className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:border-emerald-500 transition-all group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Ошейники</span>
            <Radio className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-black text-slate-900">{stats.onlineDevices}</div>
          <div className="text-[11px] text-slate-500 mt-1">Из {stats.totalDevices} активны</div>
        </Link>

        {/* Low Battery */}
        <Link
          href="/devices"
          className={`p-4 rounded-2xl border transition-all ${
            stats.lowBatteryDevices > 0 ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-white border-slate-200/80 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${stats.lowBatteryDevices > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
              Слабый заряд
            </span>
            <BatteryWarning className={`w-4 h-4 ${stats.lowBatteryDevices > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
          </div>
          <div className={`text-2xl font-black ${stats.lowBatteryDevices > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
            {stats.lowBatteryDevices}
          </div>
          <div className={`text-[11px] mt-1 ${stats.lowBatteryDevices > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
            Ошейников &le; 15%
          </div>
        </Link>

        {/* Active Alerts */}
        <Link
          href="/alerts"
          className={`p-4 rounded-2xl border transition-all ${
            stats.activeAlertsCount > 0 ? 'bg-red-500 text-white shadow-lg shadow-red-900/20' : 'bg-white border-slate-200/80 shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${stats.activeAlertsCount > 0 ? 'text-white/90' : 'text-slate-500'}`}>
              Тревоги
            </span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black">{stats.activeAlertsCount}</div>
          <div className={`text-[11px] mt-1 ${stats.activeAlertsCount > 0 ? 'text-white/80' : 'text-slate-500'}`}>
            Активных инцидентов
          </div>
        </Link>
      </div>

      {/* Main Grid: Live flock list + Mini Map & Species Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: 2 Columns — Live Animals State Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-base text-slate-900">Состояние животных на выпасе</h2>
              <p className="text-xs text-slate-500">Последние координаты и состояние смарт-ошейников</p>
            </div>
            <Link
              href="/animals"
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
            >
              <span>Все животные ({stats.totalAnimals})</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-y border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Животное</th>
                  <th className="py-2.5 px-3">Вид</th>
                  <th className="py-2.5 px-3">Бирка</th>
                  <th className="py-2.5 px-3">Ошейник</th>
                  <th className="py-2.5 px-3">Батарея</th>
                  <th className="py-2.5 px-3">Статус зоны</th>
                  <th className="py-2.5 px-3 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.liveAnimals || []).map((animal: any) => {
                  const isBreach = animal.isOutsideGeofence;
                  const battery = animal.device?.battery ?? 100;

                  return (
                    <tr key={animal.id} className={`hover:bg-slate-50/80 transition-colors ${isBreach ? 'bg-red-50/30' : ''}`}>
                      <td className="py-3 px-3 font-semibold text-slate-900 flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            isBreach ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {animal.name[0]}
                        </div>
                        <div>
                          <div>{animal.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {animal.lastLatitude ? `${animal.lastLatitude.toFixed(4)} N, ${animal.lastLongitude.toFixed(4)} E` : 'Нет координат'}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 font-medium">{animal.species}</td>
                      <td className="py-3 px-3 text-xs font-mono font-semibold text-slate-700">{animal.tagNumber}</td>
                      <td className="py-3 px-3 text-xs font-mono text-slate-600">
                        {animal.device ? (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-bold">
                            {animal.device.deviceId}
                          </span>
                        ) : (
                          <span className="text-slate-400">Не привязан</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs font-medium">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-2 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className={`h-full ${battery <= 15 ? 'bg-red-500' : battery <= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${battery}%` }}
                            ></div>
                          </div>
                          <span className={`text-[11px] ${battery <= 15 ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                            {battery}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {isBreach ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 border border-red-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping"></span>
                            ВНЕ ПАСТБИЩА
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            На пастбище
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Link
                          href={`/map?animalId=${animal.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors border border-emerald-200"
                        >
                          <span>Карта</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Species Breakdown + Recent Alerts */}
        <div className="space-y-6">
          {/* Species Distribution Widget */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-sm text-slate-900 mb-3 flex items-center justify-between">
              <span>Состав стада</span>
              <span className="text-xs text-slate-500 font-normal">{stats.totalAnimals} голов</span>
            </h3>
            <div className="space-y-2.5">
              {Object.entries(data?.speciesBreakdown || {}).map(([species, count]: [string, any]) => {
                const pct = stats.totalAnimals > 0 ? Math.round((count / stats.totalAnimals) * 100) : 0;
                return (
                  <div key={species}>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                      <span>{speciesNameMap[species] || species}</span>
                      <span>{count} гол. ({pct}%)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Alerts Feed */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900">Лента инцидентов</h3>
              <Link href="/alerts" className="text-xs text-emerald-700 font-semibold hover:underline">
                Все тревоги
              </Link>
            </div>

            <div className="space-y-2.5">
              {(data?.recentAlerts || []).slice(0, 4).map((alert: any) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                    alert.status === 'ACTIVE'
                      ? 'bg-red-50/80 border-red-200 text-red-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${alert.status === 'ACTIVE' ? 'text-red-600' : 'text-slate-400'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{alert.message}</div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(alert.createdAt).toLocaleTimeString('ru-RU')}</span>
                      <span>•</span>
                      <span className="font-medium uppercase">{alert.status}</span>
                    </div>
                  </div>
                </div>
              ))}

              {(!data?.recentAlerts || data.recentAlerts.length === 0) && (
                <div className="py-6 text-center text-xs text-slate-400">
                  Активных тревог нет. Всё поголовье в безопасности.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

