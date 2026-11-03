'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClient } from '../../../lib/api';
import { Trees, Lock, Mail, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('farmer@qamqor.kz');
  const [password, setPassword] = useState('qamqor2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await ApiClient.login({ email, password });
      router.push('/map');
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans text-slate-100">
      <div className="max-w-sm w-full bg-slate-900 rounded-lg p-6 shadow-2xl border border-slate-800 space-y-5">
        {/* Brand */}
        <div className="text-center space-y-1.5">
          <div className="w-10 h-10 mx-auto rounded-md bg-emerald-600 flex items-center justify-center text-white">
            <Trees className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">QAMQOR CLOUD</h1>
          <p className="text-xs text-slate-400 font-mono">
            Smart Livestock Monitoring Platform
          </p>
        </div>

        {error && (
          <div className="p-2.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs font-mono">
          <div>
            <label className="block text-slate-400 mb-1">Email пользователя</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="farmer@qamqor.kz"
                className="w-full pl-8 pr-2.5 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 outline-none focus:border-emerald-500 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Пароль доступа</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-8 pr-2.5 py-2 bg-slate-950 border border-slate-700 rounded text-slate-200 outline-none focus:border-emerald-500 text-xs"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <span>{loading ? 'Авторизация...' : 'Войти в систему'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-slate-400 space-y-1">
          <div className="text-slate-300 font-semibold flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Демо-аккаунт:</span>
          </div>
          <div>Email: <span className="text-emerald-400">farmer@qamqor.kz</span></div>
          <div>Пароль: <span className="text-emerald-400">qamqor2026</span></div>
        </div>
      </div>
    </div>
  );
}
