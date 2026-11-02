'use client';

import React from 'react';
import { useAuth } from '../../../lib/auth-context';
import { Settings, Building2, Bell, Radio, Shield, Globe } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Настройки платформы</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Параметры хозяйства, пороговые значения тревог и интервалы опроса ошейников
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
        {/* Farm details */}
        <div>
          <h3 className="font-bold text-sm text-slate-900 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <span>Параметры хозяйства</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-500 font-semibold mb-1">Название хозяйства</label>
              <input
                type="text"
                disabled
                value={user?.farmName || '«Ақбұлақ» шаруа қожалығы'}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-semibold mb-1">Регион выпаса</label>
              <input
                type="text"
                disabled
                value="Мангистауская область, Каракиянский район"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
              />
            </div>
          </div>
        </div>

        {/* Telemetry settings */}
        <div className="pt-4 border-t border-slate-100">
          <h3 className="font-bold text-sm text-slate-900 mb-3 flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-600" />
            <span>Интервалы передачи данных ESP32</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
              <div className="font-bold text-slate-800">Штатный интервал (Deep Sleep)</div>
              <div className="text-slate-500 text-[11px]">300 секунд (5 минут)</div>
              <p className="text-[11px] text-slate-400">Обеспечивает автономность аккумулятора ошейника</p>
            </div>
            <div className="p-4 bg-red-50/60 rounded-xl border border-red-100 space-y-1">
              <div className="font-bold text-red-900">Аварийный интервал (При побеге)</div>
              <div className="text-red-700 font-bold text-[11px]">60 секунд (1 минута)</div>
              <p className="text-[11px] text-red-600/80">Автоматически активируется при выходе скота за границу</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

