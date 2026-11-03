'use client';

import React, { useState, useEffect } from 'react';
import { AuthProvider } from '../../lib/auth-context';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header } from '../../components/layout/Header';
import { ApiClient } from '../../lib/api';

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);

  const fetchAlertCount = async () => {
    try {
      const stats = await ApiClient.getAlertStats();
      if (stats?.activeTotal !== undefined) {
        setActiveAlertsCount(stats.activeTotal);
      }
    } catch {}
  };

  useEffect(() => {
    fetchAlertCount();
    const timer = setInterval(fetchAlertCount, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar activeAlertsCount={activeAlertsCount} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header activeAlertsCount={activeAlertsCount} />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
