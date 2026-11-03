'use client';

import React from 'react';
import { Trees } from 'lucide-react';

interface HeaderProps {
  activeAlertsCount?: number;
}

export function Header({ activeAlertsCount = 0 }: HeaderProps) {
  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800 px-4 md:px-6 flex items-center justify-between shrink-0 z-20">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center text-white font-bold shrink-0">
          <Trees className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm tracking-tight text-white font-mono">QAMQOR IoT</span>
          <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">• Мониторинг ошейника</span>
        </div>
      </div>
    </header>
  );
}
