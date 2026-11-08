import Constants from 'expo-constants';
import {
  Animal,
  Collar,
  AlertItem,
  AlertStats,
  AuthResponse,
  FarmDto,
  GeofencePen,
  MembershipDto,
  UserDto,
} from '../types';

// Base URL: EXPO_PUBLIC_API_URL, else app.json extra.apiUrl, else the deployed server.
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'https://qamqor-api.onrender.com/api/v1'
).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const CODE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Неверный email или пароль, либо сессия истекла',
  FORBIDDEN_ROLE: 'Недостаточно прав для этого действия',
  FORBIDDEN_FARM: 'Нет доступа к этой ферме',
  NOT_FOUND: 'Не найдено',
  CONFLICT: 'Конфликт: такая запись уже существует',
  RATE_LIMITED: 'Слишком много запросов, попробуйте позже',
  VALIDATION: 'Проверьте введённые данные',
};

/** Human-readable Russian text for any error thrown by the API layer. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return CODE_MESSAGES[e.code] || e.message;
  return 'Нет связи с сервером. Проверьте интернет и повторите.';
}

/** Collar code: exactly 8 digits (docs/architecture/device-code-protocol.md). */
export const COLLAR_CODE_RE = /^[0-9]{8}$/;

class QamqorApiClient {
  private token: string | null = null;
  private farmId: string | null = null;
  private onUnauthorized: (() => void) | null = null;

  setAuthToken(token: string | null) {
    this.token = token;
  }
  setFarmId(id: string | null) {
    this.farmId = id;
  }
  setUnauthorizedHandler(fn: (() => void) | null) {
    this.onUnauthorized = fn;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (this.farmId) headers['x-farm-id'] = this.farmId;

    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

    if (!response.ok) {
      let code = 'HTTP_' + response.status;
      let message = response.statusText || 'Ошибка сервера';
      try {
        const body = await response.json();
        if (body?.code) code = String(body.code);
        if (body?.message) message = Array.isArray(body.message) ? body.message.join('; ') : String(body.message);
      } catch {
        /* non-JSON error body */
      }
      if (response.status === 401 && this.token) {
        this.onUnauthorized?.();
      }
      throw new ApiError(response.status, code, message);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // --- auth ---
  login(email: string, password: string) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }
  register(input: { email: string; password: string; fullName: string; farmName?: string }) {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  me() {
    return this.request<{ user: UserDto; memberships: MembershipDto[] }>('/auth/me');
  }

  // --- farm ---
  getFarm(id: string) {
    return this.request<FarmDto>(`/farms/${id}`);
  }
  setWorkerCanEditBoundaries(id: string, value: boolean) {
    return this.request<FarmDto>(`/farms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ workerCanEditBoundaries: value }),
    });
  }

  // --- data ---
  getAnimals() {
    return this.request<Animal[]>('/animals?limit=100');
  }
  /** POST /animals (W). Returns the created animal. */
  createAnimal(input: { name: string; tag: string; species: Animal['species']; breed?: string; penId?: string }) {
    return this.request<Animal>('/animals', { method: 'POST', body: JSON.stringify(input) });
  }
  getAnimal(id: string) {
    return this.request<Animal>(`/animals/${id}`);
  }
  getCollars() {
    return this.request<Collar[]>('/devices');
  }
  getGeofences() {
    return this.request<GeofencePen[]>('/geofences');
  }
  getAlerts() {
    return this.request<AlertItem[]>('/alerts?limit=100');
  }
  getAlertStats() {
    return this.request<AlertStats>('/alerts/stats');
  }
  setAlertStatus(id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') {
    return this.request<AlertItem>(`/alerts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  /** Queues a test signal; the collar picks it up on its next ping (202 {commandId}). */
  testSignal(deviceId: string, signal: 'SOUND' | 'VIBRATION') {
    return this.request<{ commandId: string }>(`/devices/${encodeURIComponent(deviceId)}/test-signal`, {
      method: 'POST',
      body: JSON.stringify({ signal }),
    });
  }

  /**
   * Collar registration by its 8-digit code (owner only).
   * ASSUMPTION: the server's current contract is POST /devices {deviceId, animalId?};
   * the 8-digit code is sent as `deviceId` (it satisfies 3-40 chars A-Za-z0-9_-).
   * If the server adds a dedicated "claim by code" endpoint, change ONLY this function.
   */
  registerCollarByCode(code: string) {
    return this.request<{ collar: Collar; deviceSecret?: string }>('/devices', {
      method: 'POST',
      body: JSON.stringify({ deviceId: code }),
    });
  }

  /** Bind / unbind a collar (null = unbind). PATCH /devices/:deviceId {animalId}. */
  assignCollar(deviceId: string, animalId: string | null) {
    return this.request<Collar>(`/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ animalId }),
    });
  }
}

export const api = new QamqorApiClient();

/** "5 мин назад" computed locally from an ISO time. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'нет данных';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}
