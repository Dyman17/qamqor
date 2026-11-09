import { ssDel, ssGet, ssSet } from '../storage';

// ---- DTOs (docs/architecture/api-contract.md section 2) ----
export type DataMode = 'REAL' | 'MANUAL' | 'AUTO';
export type Role = 'OWNER' | 'WORKER';
export type AnimalStatus = 'ok' | 'danger' | 'warning' | 'offline';
export type ConnState = 'ONLINE' | 'OFFLINE' | 'UNASSIGNED';
export interface UserDto { id: string; email: string; fullName: string; phone?: string }
export interface MembershipDto { farmId: string; farmName: string; role: Role }
export interface AuthResponse { token: string; user: UserDto; memberships: MembershipDto[] }
export interface FarmDto { id: string; name: string; description?: string; timezone: string; workerCanEditBoundaries: boolean; myRole: Role; dataMode?: DataMode }
export interface SignalLimitDto { level: 'SOUND' | 'VIBRATION' | 'IMPULSE'; dailyLimit: number | null; unlimited: boolean }
export interface AnimalDto {
  id: string; farmId: string; name: string; tag: string; species: 'CATTLE' | 'HORSE' | 'CAMEL' | 'SHEEP' | 'GOAT'; gender?: string; breed?: string;
  penId: string | null; collarId: string | null; lat: number | null; lng: number | null; accuracyM: number | null; lastSeenAt: string | null; status: AnimalStatus; isDemo?: boolean;
  lastHeartRate?: number | null; lastHeartRateAt?: string | null;
}
export interface CollarDto { deviceId: string; status: ConnState; animalId: string | null; animalName: string | null; signalRssi: number | null; firmwareVersion: string | null; lastSeenAt: string | null; isDemo?: boolean }
export interface PenDto { id: string; farmId: string; name: string; color: string; polygon: { type: 'Polygon'; coordinates: number[][][] }; animalsCount: number; areaHa: number; isDemo?: boolean }
export type AlertType = 'GEOFENCE_BREACH' | 'GEOFENCE_RETURN' | 'DEVICE_OFFLINE' | 'DEVICE_RESTORED' | 'SIGNAL_LIMIT_REACHED' | 'GPS_LOST';
export interface AlertDto {
  id: string; type: AlertType; severity: 'INFO' | 'WARNING' | 'CRITICAL'; status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  animalId: string | null; animalName: string | null; penName: string | null; message: string; lat: number | null; lng: number | null; createdAt: string; isRead: boolean; isDemo?: boolean;
}
export interface InvitationDto { id: string; email: string; status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'; expiresAt: string }
export interface MembersResponse { members: { userId: string; email: string; fullName: string; role: Role }[]; invitations: InvitationDto[] }
export interface SignalsDto { day: string; sound: { used: number; limit: number | null }; vibration: { used: number; limit: number | null }; impulse: unknown }
export interface EventsDto { alerts: AlertDto[]; signals: SignalsDto }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  get network(): boolean { return this.code === 'NETWORK'; }
}

const BASE = '/api/v1';
const TOKEN_KEY = 'qamqor.token';
const FARM_KEY = 'qamqor.farm';

// JWT lives in memory and in sessionStorage (per tab, gone when the tab closes); never in localStorage.
let token: string | null = ssGet(TOKEN_KEY);
let farmId: string | null = ssGet(FARM_KEY);
const authListeners = new Set<() => void>();
const netListeners = new Set<(s: NetState) => void>();

export interface NetState { offline: boolean; server: boolean; rateLimited: boolean; lastOk: number }
export const net: NetState = { offline: !navigator.onLine, server: false, rateLimited: false, lastOk: Date.now() };
function setNet(p: Partial<NetState>): void {
  Object.assign(net, p);
  netListeners.forEach((l) => l(net));
}
export function onNet(cb: (s: NetState) => void): () => void { netListeners.add(cb); return () => netListeners.delete(cb); }
window.addEventListener('online', () => setNet({ offline: false }));
window.addEventListener('offline', () => setNet({ offline: true }));

export const getToken = (): string | null => token;
export function setSession(t: string | null): void {
  token = t;
  if (t) ssSet(TOKEN_KEY, t); else { ssDel(TOKEN_KEY); ssDel(FARM_KEY); farmId = null; }
}
export const getFarmId = (): string | null => farmId;
export function setFarmId(id: string | null): void {
  farmId = id;
  if (id) ssSet(FARM_KEY, id); else ssDel(FARM_KEY);
}
export function onUnauthenticated(cb: () => void): () => void { authListeners.add(cb); return () => authListeners.delete(cb); }

export interface Res<T> { data: T; next: string | null }

export async function request<T>(method: string, path: string, body?: unknown, opts: { farm?: boolean; auth?: boolean; signal?: AbortSignal } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (opts.farm !== false && farmId) headers['x-farm-id'] = farmId;
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: opts.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    setNet({ offline: !navigator.onLine, server: navigator.onLine });
    throw new ApiError(0, 'NETWORK', 'network');
  }
  setNet({ server: false, rateLimited: res.status === 429, ...(res.ok ? { lastOk: Date.now(), offline: false } : {}) });
  if (res.status === 204) return { data: undefined as T, next: null };
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty or not JSON */ }
  if (!res.ok) {
    const j = (json ?? {}) as { code?: string; message?: string | string[] };
    const code = j.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : res.status === 429 ? 'RATE_LIMITED' : res.status >= 500 ? 'SERVER' : 'ERROR');
    if (res.status >= 500) setNet({ server: true });
    if (res.status === 401 && opts.auth !== false && token) { setSession(null); authListeners.forEach((l) => l()); }
    throw new ApiError(res.status, code, Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? code));
  }
  return { data: json as T, next: res.headers.get('X-Next-Cursor') };
}

export const get = <T>(p: string, o?: { farm?: boolean; signal?: AbortSignal }) => request<T>('GET', p, undefined, o).then((r) => r.data);
export const post = <T>(p: string, b?: unknown, o?: { farm?: boolean; auth?: boolean }) => request<T>('POST', p, b ?? {}, o).then((r) => r.data);
export const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b).then((r) => r.data);
export const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b).then((r) => r.data);
export const del = (p: string) => request<void>('DELETE', p).then(() => undefined);

// ---- collar registration by the 8-digit device code (docs/architecture/device-code-protocol.md) ----
export const DEVICE_CODE_RE = /^[0-9]{8}$/;
/** The only place that registers a collar: POST /devices { code, animalId? }. The code is the device identity; no secret is returned. */
export const registerCollarByCode = (code: string, animalId?: string) =>
  post<{ collar: CollarDto }>('/devices', animalId ? { code, animalId } : { code });

// ---- demo modes (docs/architecture/api-contract.md, server/src/simulation) ----
export type SimSpeed = 1 | 2 | 5 | 10;
export type SimEvent = 'BREACH' | 'ESCAPE' | 'RETURN' | 'GPS_LOST' | 'COLLAR_OFFLINE' | 'COLLAR_ONLINE';
export interface SimulationDto { dataMode: DataMode; running: boolean; speed: number; herd: number; until: string | null; demo: { animals: number; alerts: number }; enabled: boolean }
export interface CollarResponseDto { zone: string; inFence: boolean | null; distanceToBorderMeters: number | null; sound: boolean; vibrate: boolean; toneFrequencyHz: number; suppressedBy: 'SIGNAL_LIMIT' | null }
export const simApi = {
  get: (farm: string) => get<SimulationDto>(`/farms/${farm}/simulation`),
  setMode: (farm: string, mode: DataMode) => put<SimulationDto>(`/farms/${farm}/data-mode`, { mode }),
  start: (farm: string, p: { speed?: SimSpeed; herd?: number; hours?: number }) => post<SimulationDto>(`/farms/${farm}/simulation/start`, p),
  stop: (farm: string) => post<SimulationDto>(`/farms/${farm}/simulation/stop`),
  reset: (farm: string) => post<SimulationDto>(`/farms/${farm}/simulation/reset`),
  setSpeed: (farm: string, speed: SimSpeed) => patch<SimulationDto>(`/farms/${farm}/simulation`, { speed }),
  addAnimal: (farm: string, p: { name?: string; species?: AnimalDto['species'] }) => post<AnimalDto>(`/farms/${farm}/simulate/animals`, p),
  telemetry: (farm: string, p: { animalId: string; lat: number; lng: number; accuracyM?: number; speedKmh?: number }) => post<CollarResponseDto>(`/farms/${farm}/simulate/telemetry`, p),
  event: (farm: string, p: { animalId: string; event: SimEvent }) => post<CollarResponseDto | { ok: true }>(`/farms/${farm}/simulate/events`, p),
};
