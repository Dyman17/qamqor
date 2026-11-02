'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { ApiClient } from './api';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  farmId?: string;
  farmName?: string;
}

interface AuthContextType {
  user: User | null;
  currentFarmId: string | null;
  loading: boolean;
  setCurrentFarmId: (farmId: string) => void;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentFarmId, setCurrentFarmIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setCurrentFarmId = (farmId: string) => {
    setCurrentFarmIdState(farmId);
    ApiClient.setActiveFarmId(farmId);
  };

  const refreshUser = async () => {
    try {
      const data = await ApiClient.getMe();
      if (data) {
        const primaryFarm = data.farms?.[0];
        setUser({
          id: data.id,
          email: data.email,
          fullName: data.fullName,
          role: data.role,
          farmId: primaryFarm?.id,
          farmName: primaryFarm?.name,
        });

        const activeFarm = ApiClient.getActiveFarmId() || primaryFarm?.id;
        if (activeFarm) {
          setCurrentFarmIdState(activeFarm);
          ApiClient.setActiveFarmId(activeFarm);
        }
      }
    } catch (e) {
      // Auto-fallback in local dev: auto-login with default seeded farmer credentials!
      try {
        const loginData = await ApiClient.login({
          email: 'farmer@qamqor.kz',
          password: 'qamqor2026',
        });
        setUser(loginData.user);
        if (loginData.user.farmId) {
          setCurrentFarmIdState(loginData.user.farmId);
        }
      } catch (err) {
        ApiClient.clearSession();
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (credentials: { email: string; password: string }) => {
    const data = await ApiClient.login(credentials);
    setUser(data.user);
    if (data.user.farmId) {
      setCurrentFarmId(data.user.farmId);
    }
  };

  const logout = () => {
    ApiClient.clearSession();
    setUser(null);
    setCurrentFarmIdState(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        currentFarmId,
        loading,
        setCurrentFarmId,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

