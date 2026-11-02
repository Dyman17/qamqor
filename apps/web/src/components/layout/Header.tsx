'use client';

import React, { useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import {
  Bell,
  Globe,
  Radio,
  Sliders,
  ChevronDown,
  Building2,
  LogOut,
  User,
} from 'lucide-react';

interface HeaderProps {
  onOpenMockPanel?: () => void;
  activeAlertsCount?: number;
}

export function Header({ onOpenMockPanel, activeAlertsCount = 0 }: HeaderProps) {
  const { user, logout } = useAuth();
  const [lang, setLang] = useState<'KZ' | 'RU'>('RU');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm z-20">
      {/* Left: Farm details & switcher */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-900 text-sm font-semibold">
          <Building2 className="w-4 h-4 text-emerald-600" />
          <span>{user?.farmName || '«Ақбұлақ» шаруа қожалығы'}</span>
        </div>

        {/* Live System Indicator */}
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>IoT Gateway Online</span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {/* Quick Test / Mock Dialog Button */}
        {onOpenMockPanel && (
          <button
            onClick={onOpenMockPanel}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border border-amber-500/30 transition-colors shadow-sm"
            title="Ручной ввод GPS и тестирование побега без физического ESP32"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Эмулятор ESP / Тест</span>
          </button>
        )}

        {/* Language switch */}
        <button
          onClick={() => setLang(lang === 'RU' ? 'KZ' : 'RU')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors"
        >
          <Globe className="w-3.5 h-3.5 text-slate-500" />
          <span>{lang}</span>
        </button>

        {/* Alerts Bell */}
        <div className="relative">
          <button className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 relative transition-colors">
            <Bell className="w-4 h-4" />
            {activeAlertsCount > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white"></span>
            )}
          </button>
        </div>

        {/* Farmer Profile Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2.5 pl-2 py-1 pr-1.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center shadow">
              {user?.fullName ? user.fullName[0] : 'Б'}
            </div>
            <div className="text-left hidden md:block">
              <div className="text-xs font-bold text-slate-800 leading-tight">
                {user?.fullName || 'Берік Қасымұлы'}
              </div>
              <div className="text-[10px] text-slate-500">{user?.role || 'Владелец хозяйства'}</div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* Profile Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 text-sm">
              <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-500">
                {user?.email || 'farmer@qamqor.kz'}
              </div>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  logout();
                }}
                className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium"
              >
                <LogOut className="w-4 h-4" />
                <span>Выйти из аккаунта</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

