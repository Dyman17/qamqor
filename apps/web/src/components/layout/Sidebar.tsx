'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MapPin,
  Trees,
  ShieldAlert,
  Server,
  Radio,
  Sliders,
} from 'lucide-react';

interface SidebarProps {
  activeAlertsCount?: number;
}

export function Sidebar({ activeAlertsCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { name: 'Карта пастбищ & Ошейники', href: '/map', icon: MapPin },
    {
      name: 'Журнал сработок и тревог',
      href: '/alerts',
      icon: ShieldAlert,
      badge: activeAlertsCount > 0 ? activeAlertsCount : null,
      badgeColor: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
    },
  ];

  return (
    <aside className="w-60 bg-slate-950 text-slate-300 flex flex-col shrink-0 min-h-screen border-r border-slate-800">
      {/* Brand Header */}
      <div className="h-14 flex items-center px-4 gap-2.5 border-b border-slate-800 bg-slate-950">
        <div className="w-8 h-8 rounded-md bg-emerald-600 flex items-center justify-center text-white font-bold shrink-0">
          <Trees className="w-4 h-4" />
        </div>
        <div>
          <div className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
            QAMQOR
            <span className="text-[10px] uppercase font-mono font-semibold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              IoT
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">Smart Livestock Platform</div>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-2.5 py-4 space-y-1">
        <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 font-mono">
          Мониторинг
        </div>

        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2 rounded-md font-medium text-xs transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span
                  className={`px-1.5 py-0.2 text-[10px] font-mono font-bold rounded ${item.badgeColor || 'bg-slate-800 text-slate-300'}`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* System Status Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950 text-xs">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[11px]">База данных:</span>
          <span className="flex items-center gap-1.5 text-emerald-400 font-mono text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            PostgreSQL Live
          </span>
        </div>
        <div className="text-[10px] text-slate-400 font-mono">ESP32 Ingestion: Active</div>
      </div>
    </aside>
  );
}
