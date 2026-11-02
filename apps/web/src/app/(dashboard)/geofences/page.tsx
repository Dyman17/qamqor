'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiClient } from '../../../lib/api';
import {
  Trees,
  Plus,
  MapPin,
  Compass,
  CheckCircle2,
  Calendar,
  Layers,
  ExternalLink,
} from 'lucide-react';

export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiClient.listGeofences()
      .then(setGeofences)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Виртуальные пастбища (Geofences)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Контроль безопасных границ выпаса и автоматическое определение выхода скота
          </p>
        </div>
        <Link
          href="/map"
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-bold shadow-md transition-colors"
        >
          <MapPin className="w-4 h-4" />
          <span>Нарисовать на карте</span>
        </Link>
      </div>

      {/* Geofences List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {geofences.map((gf) => {
          const color = gf.color || '#10b981';
          const coordinates = gf.polygonJson?.coordinates?.[0] || [];

          return (
            <div
              key={gf.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm"
                    style={{ backgroundColor: color }}
                  >
                    <Trees className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900">{gf.name}</h3>
                    <p className="text-xs text-slate-400">{gf.description || 'Основная зона выпаса'}</p>
                  </div>
                </div>

                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Активно
                </span>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Поголовье внутри</div>
                  <div className="font-bold text-slate-800 text-sm mt-0.5 flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-emerald-600" />
                    <span>{gf.animalsCount || 4} голов</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Вершин периметра</div>
                  <div className="font-bold text-slate-800 text-sm mt-0.5 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-slate-500" />
                    <span>{coordinates.length} точек</span>
                  </div>
                </div>
              </div>

              {/* Coordinates Preview */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400">Координаты периметра (GeoJSON):</div>
                <div className="bg-slate-900 text-slate-300 p-2.5 rounded-xl font-mono text-[10px] leading-relaxed max-h-20 overflow-y-auto">
                  {coordinates.map((pt: any, i: number) => (
                    <div key={i}>
                      [{pt[0]?.toFixed(4)}°E, {pt[1]?.toFixed(4)}°N]
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="pt-2 flex items-center justify-between border-t border-slate-100 text-xs">
                <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                  <Calendar className="w-3 h-3" />
                  {new Date(gf.createdAt).toLocaleDateString('ru-RU')}
                </span>
                <Link
                  href="/map"
                  className="font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                >
                  <span>Смотреть на карте</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

