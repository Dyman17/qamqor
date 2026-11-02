'use client';

import React from 'react';
import { useAuth } from '../../../lib/auth-context';
import { Users, Shield, Plus, Mail, Phone, CheckCircle2 } from 'lucide-react';

export default function TeamPage() {
  const { user } = useAuth();

  const members = [
    {
      id: '1',
      name: user?.fullName || 'Берік Қасымұлы',
      email: user?.email || 'farmer@qamqor.kz',
      phone: '+7 777 123 4567',
      role: 'FARM_OWNER',
      roleTitle: 'Владелец хозяйства',
      status: 'ACTIVE',
    },
    {
      id: '2',
      name: 'Ернар Бауыржанұлы',
      email: 'ernar.pasture@qamqor.kz',
      phone: '+7 701 987 6543',
      role: 'FARM_MANAGER',
      roleTitle: 'Старший чабан (Менеджер)',
      status: 'ACTIVE',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Сотрудники и чабаны</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Управление правами доступа к мониторингу скота и получению тревог
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-bold shadow-md transition-colors">
          <Plus className="w-4 h-4" />
          <span>Пригласить сотрудника</span>
        </button>
      </div>

      {/* Team Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {members.map((m) => (
          <div key={m.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-base shadow-sm">
                  {m.name[0]}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{m.name}</h3>
                  <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1 mt-0.5">
                    <Shield className="w-3.5 h-3.5" />
                    <span>{m.roleTitle}</span>
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" />
                Активен
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-slate-500 pt-1 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{m.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{m.phone}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

