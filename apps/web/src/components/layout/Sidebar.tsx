'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MapPin, ShieldAlert, Trees } from 'lucide-react';

interface SidebarProps {
  activeAlertsCount?: number;
}

export function Sidebar({ activeAlertsCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { name: 'Карта пастбищ & Зуммер', href: '/map', icon: MapPin },
  ];

  return (
    <aside className="w-56 bg-slate-950 text-slate-300 flex flex-col shrink-0 min-h-screen border-r border-slate-800 font-mono text-xs">
      <div className="h-14 flex items-center px-4 gap-2 border-b border-slate-800 bg-slate-950">
        <div className="w-7 h-7 rounded bg-emerald-600 flex items-center justify-center text-white font-bold shrink-0">
          <Trees className="w-4 h-4" />
        </div>
        <span className="font-bold text-sm tracking-tight text-white">QAMQOR</span>
      </div>

      <nav className="flex-1 px-2.5 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
