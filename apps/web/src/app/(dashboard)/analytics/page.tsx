'use client';

import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../../lib/api';
import {
  LineChart,
  Calendar,
  Compass,
  AlertTriangle,
  Battery,
  Trees,
  TrendingUp,
} from 'lucide-react';

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiClient.getOverview()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const stats = data?.stats || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Аналитика и отчёты хозяйства</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Динамика выпаса, статистика инцидентов и здоровье стада
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 bg-white border border-slate-200 rounded-xl shadow-sm text-slate-700">
          <Calendar className="w-3.5 h-3.5 text-emerald-600" />
          <span>Период: Последние 30 дней</span>
        </div>
      </div>

      {/* Analytics KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs uppercase font-bold text-slate-400">Поголовье на учёте</div>
          <div className="text-3xl font-black text-slate-900">{stats.totalAnimals || 4}</div>
          <div className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            <span>100% охват смарт-ошейниками</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs uppercase font-bold text-slate-400">Эффективность выпаса</div>
          <div className="text-3xl font-black text-emerald-700">98.4%</div>
          <div className="text-[11px] text-slate-500">Время нахождения внутри пастбищ</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs uppercase font-bold text-slate-400">Побегов зафиксировано</div>
          <div className="text-3xl font-black text-red-600">{stats.activeAlertsCount || 0}</div>
          <div className="text-[11px] text-slate-500">Автоматически оповещены чабаны</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="text-xs uppercase font-bold text-slate-400">Средний заряд ошейников</div>
          <div className="text-3xl font-black text-slate-900">89%</div>
          <div className="text-[11px] text-emerald-600 font-semibold">Оптимальный уровень</div>
        </div>
      </div>

      {/* Visual Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900 flex items-center justify-between">
            <span>Распределение поголовья по видам</span>
            <Compass className="w-4 h-4 text-emerald-600" />
          </h3>
          <div className="space-y-3">
            {Object.entries(data?.speciesBreakdown || {}).map(([sp, count]: [string, any]) => (
              <div key={sp} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>{sp}</span>
                  <span>{count} гол.</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full"
                    style={{ width: `${(count / (stats.totalAnimals || 1)) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900 flex items-center justify-between">
            <span>Надёжность передачи GPS телеметрии</span>
            <Trees className="w-4 h-4 text-emerald-600" />
          </h3>
          <p className="text-xs text-slate-500">
            Ошейники ESP32 просыпаются по расписанию и выходят на связь через сотовую сеть LTE/2G.
          </p>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Штатный интервал передачи:</span>
              <span className="font-bold font-mono text-slate-800">300 сек (5 минут)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Аварийный интервал при побеге:</span>
              <span className="font-bold font-mono text-red-600">60 сек (1 минута)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Точность геопозиционирования:</span>
              <span className="font-bold text-emerald-700">&le; 3–5 метров</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

