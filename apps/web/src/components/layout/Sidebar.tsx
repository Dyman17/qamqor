'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MapPin,
  Trees,
  Radio,
  Camera,
  LineChart,
  Users,
  Settings,
  ShieldAlert,
  Compass,
} from 'lucide-react';

interface SidebarProps {
  activeAlertsCount?: number;
}

export function Sidebar({ activeAlertsCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { name: 'Карта & Ошейник ESP32', href: '/map', icon: MapPin },
    {
      name: 'Журнал сработок',
      href: '/alerts',
      icon: ShieldAlert,
      badge: activeAlertsCount > 0 ? activeAlertsCount : null,
      badgeColor: 'bg-red-500 text-white',
    },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-screen border-r border-slate-800">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 gap-3 border-b border-slate-800 bg-slate-950">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-900/40">
          <Trees className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-lg tracking-tight text-white flex items-center gap-1.5">
            QAMQOR
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              IoT
            </span>
          </div>
          <div className="text-[11px] text-slate-400">Smart Livestock Cloud</div>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Управление хозяйством
        </div>

        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-full ${item.badgeColor || 'bg-slate-700 text-slate-200'}`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* System Footer Info */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/60 text-xs">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span>Связь с базой</span>
          <span className="flex items-center gap-1 text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            PostGIS Active
          </span>
        </div>
        <div className="text-[11px] text-slate-500">v1.2.0 • ESP32 / LTE Ingestion</div>
      </div>
    </aside>
  );
}
