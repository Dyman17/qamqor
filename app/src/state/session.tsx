import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { AuthResponse, DataMode, MembershipDto, Role, UserDto } from '../types';

interface Session {
  user: UserDto | null;
  memberships: MembershipDto[];
  farmId: string | null;
  farm: MembershipDto | null;
  role: Role | null;
  isOwner: boolean;
  /** stored session is still being restored */
  restoring: boolean;
  /** farm data mode; anything but REAL means demo data is present */
  dataMode: DataMode;
  setDataMode: (m: DataMode) => void;
  refreshMode: () => void;
  /** signed in and a farm is chosen (or the only one) */
  ready: boolean;
  signIn: (r: AuthResponse) => void;
  signOut: () => void;
  selectFarm: (id: string) => void;
  /** go back to the farm picker */
  changeFarm: () => void;
}

const Ctx = createContext<Session | null>(null);

const KEY = 'qamqor.session.v1';
interface Stored { token: string; user: UserDto; memberships: MembershipDto[]; farmId: string | null }
async function save(s: Stored | null) {
  try {
    if (s) await AsyncStorage.setItem(KEY, JSON.stringify(s));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session stays in memory */
  }
}
export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [memberships, setMemberships] = useState<MembershipDto[]>([]);
  const [farmId, setFarmId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [dataMode, setDataMode] = useState<DataMode>('REAL');
  const tokenRef = React.useRef<string | null>(null);
  const snapRef = React.useRef<{ user: UserDto; memberships: MembershipDto[] } | null>(null);

  const signOut = useCallback(() => {
    tokenRef.current = null;
    snapRef.current = null;
    save(null);
    api.setAuthToken(null);
    api.setFarmId(null);
    setUser(null);
    setMemberships([]);
    setFarmId(null);
  }, []);

  const persist = useCallback((u: UserDto, m: MembershipDto[], fid: string | null) => {
    snapRef.current = { user: u, memberships: m };
    if (tokenRef.current) save({ token: tokenRef.current, user: u, memberships: m, farmId: fid });
  }, []);

  const selectFarm = useCallback((id: string) => {
    api.setFarmId(id);
    setFarmId(id);
    if (snapRef.current) persist(snapRef.current.user, snapRef.current.memberships, id);
  }, [persist]);

  const changeFarm = useCallback(() => {
    api.setFarmId(null);
    setFarmId(null);
    if (snapRef.current) persist(snapRef.current.user, snapRef.current.memberships, null);
  }, [persist]);

  const signIn = useCallback(
    (r: AuthResponse) => {
      tokenRef.current = r.token;
      api.setAuthToken(r.token);
      setUser(r.user);
      setMemberships(r.memberships);
      if (r.memberships.length === 1) {
        api.setFarmId(r.memberships[0].farmId);
        setFarmId(r.memberships[0].farmId);
        persist(r.user, r.memberships, r.memberships[0].farmId);
      } else {
        changeFarm();
        persist(r.user, r.memberships, null);
      }
    },
    [persist, changeFarm],
  );

  // restore the stored session once, then refresh memberships from the server
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw && alive) {
          const s: Stored = JSON.parse(raw);
          tokenRef.current = s.token;
          snapRef.current = { user: s.user, memberships: s.memberships };
          api.setAuthToken(s.token);
          setUser(s.user);
          setMemberships(s.memberships);
          if (s.farmId && s.memberships.some((m) => m.farmId === s.farmId)) {
            api.setFarmId(s.farmId);
            setFarmId(s.farmId);
          }
          try {
            const me = await api.me();
            if (alive) {
              setUser(me.user);
              setMemberships(me.memberships);
              persist(me.user, me.memberships, s.farmId);
            }
          } catch {
            /* offline: keep the stored session; a 401 signs out via the handler */
          }
        }
      } catch {
        /* nothing stored */
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [persist]);

  const refreshMode = useCallback(() => {
    if (!farmId) return;
    api
      .getFarm(farmId)
      .then((f) => setDataMode(f.dataMode ?? 'REAL'))
      .catch(() => {});
  }, [farmId]);

  useEffect(() => {
    setDataMode('REAL');
    refreshMode();
    if (!farmId) return;
    const id = setInterval(refreshMode, 60000);
    return () => clearInterval(id);
  }, [farmId, refreshMode]);

  useEffect(() => {
    api.setUnauthorizedHandler(signOut);
    return () => api.setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<Session>(() => {
    const farm = memberships.find((m) => m.farmId === farmId) || null;
    return {
      user,
      memberships,
      farmId,
      farm,
      role: farm?.role ?? null,
      isOwner: farm?.role === 'OWNER',
      restoring,
      dataMode,
      setDataMode,
      refreshMode,
      ready: !!user && !!farm,
      signIn,
      signOut,
      selectFarm,
      changeFarm,
    };
  }, [user, memberships, farmId, restoring, dataMode, refreshMode, signIn, signOut, selectFarm, changeFarm]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}
