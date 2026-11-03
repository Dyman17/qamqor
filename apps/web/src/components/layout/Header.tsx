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
  ShieldAlert,
  Server,
} from 'lucide-react';
import Link from 'next/link';

interface HeaderProps {
  activeAlertsCount?: number;
}

export function Header({ activeAlertsCount = 0 }: HeaderProps) {
  const { user, logout } = useAuth();
  const [lang, setLang] = useState<'KZ' | 'RU'>('RU');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800 px-4 md:px-6 flex items-center justify-between shrink-0 z-20">
      {/* Left: Farm details & switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-200 text-xs font-medium">
          <Building2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>{user?.farmName || '«Ақбұлақ» шаруа қожалығы'}</span>
        </div>

        {/* Live System Indicator */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>ESP32 Gateway • Online</span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 md:gap-3">

        {/* Language switch */}
        <button
          onClick={() => setLang(lang === 'RU' ? 'KZ' : 'RU')}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-md hover:bg-slate-900 border border-slate-800 transition-colors"
        >
          <Globe className="w-3.5 h-3.5 text-slate-400" />
          <span>{lang}</span>
        </button>

        {/* Alerts Bell */}
        <Link
          href="/alerts"
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-md hover:bg-slate-900 border border-slate-800 relative transition-colors"
          title="Журнал тревог"
        >
          <Bell className="w-4 h-4" />
          {activeAlertsCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-[10px] font-bold text-white flex items-center justify-center">
              {activeAlertsCount}
            </span>
          )}
        </Link>

        {/* Farmer Profile Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 pl-2 py-1 pr-1.5 rounded-md hover:bg-slate-900 transition-colors border border-transparent hover:border-slate-800"
          >
            <div className="w-7 h-7 rounded-md bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center">
              {user?.fullName ? user.fullName[0] : 'Б'}
            </div>
            <div className="text-left hidden md:block">
              <div className="text-xs font-medium text-slate-200 leading-tight">
                {user?.fullName || 'Берік Қасымұлы'}
              </div>
              <div className="text-[10px] text-slate-400">{user?.role || 'FARM_OWNER'}</div>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {/* Profile Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-slate-900 rounded-md shadow-xl border border-slate-800 py-1 z-50 text-xs">
              <div className="px-3 py-2 border-b border-slate-800 text-slate-400">
                {user?.email || 'farmer@qamqor.kz'}
              </div>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  logout();
                }}
                className="w-full text-left px-3 py-2 text-rose-400 hover:bg-slate-800 flex items-center gap-2 font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Выйти из аккаунта</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
