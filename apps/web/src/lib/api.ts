/**
 * Qamqor API Client
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export class ApiClient {
  private static getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('qamqor_token');
  }

  private static setToken(token: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('qamqor_token', token);
    }
  }

  public static getActiveFarmId(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('qamqor_active_farm_id');
  }

  public static setActiveFarmId(farmId: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('qamqor_active_farm_id', farmId);
    }
  }

  public static clearSession() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('qamqor_token');
      localStorage.removeItem('qamqor_active_farm_id');
      localStorage.removeItem('qamqor_user');
    }
  }

  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const farmId = this.getActiveFarmId();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (farmId) {
      headers['x-farm-id'] = farmId;
    }

    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMsg = `HTTP Error ${response.status}`;
      try {
        const errJson = await response.json();
        errorMsg = errJson.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return response.json();
  }

  // ==========================================
  // AUTH
  // ==========================================
  public static async login(credentials: { email: string; password: string }) {
    const data = await this.request<{
      token: string;
      user: { id: string; email: string; fullName: string; role: string; farmId?: string; farmName?: string };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });

    if (data.token) {
      this.setToken(data.token);
      if (data.user.farmId) {
        this.setActiveFarmId(data.user.farmId);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('qamqor_user', JSON.stringify(data.user));
      }
    }

    return data;
  }

  public static async register(payload: { email: string; password: string; fullName: string; farmName?: string }) {
    const data = await this.request<{
      token: string;
      user: { id: string; email: string; fullName: string; role: string; farmId?: string; farmName?: string };
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (data.token) {
      this.setToken(data.token);
      if (data.user.farmId) {
        this.setActiveFarmId(data.user.farmId);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('qamqor_user', JSON.stringify(data.user));
      }
    }

    return data;
  }

  public static async getMe() {
    return this.request<{
      id: string;
      email: string;
      fullName: string;
      role: string;
      farms: Array<{ id: string; name: string; role: string }>;
    }>('/auth/me');
  }

  // ==========================================
  // FARMS
  // ==========================================
  public static async listFarms() {
    return this.request<any[]>('/farms');
  }

  public static async getFarm(id: string) {
    return this.request<any>(`/farms/${id}`);
  }

  // ==========================================
  // ANIMALS
  // ==========================================
  public static async listAnimals(filters?: { species?: string; isOutsideGeofence?: boolean; search?: string }) {
    const params = new URLSearchParams();
    if (filters?.species) params.append('species', filters.species);
    if (filters?.isOutsideGeofence !== undefined) params.append('isOutsideGeofence', String(filters.isOutsideGeofence));
    if (filters?.search) params.append('search', filters.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<any[]>(`/animals${query}`);
  }

  public static async getAnimal(id: string) {
    return this.request<any>(`/animals/${id}`);
  }

  public static async getAnimalTrack(id: string, limit = 100) {
    return this.request<{ animal: any; points: any[] }>(`/animals/${id}/track?limit=${limit}`);
  }

  public static async createAnimal(data: any) {
    return this.request<any>('/animals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==========================================
  // DEVICES (COLLARS)
  // ==========================================
  public static async listDevices() {
    return this.request<any[]>('/devices');
  }

  public static async registerDevice(data: { deviceId: string; animalId?: string }) {
    return this.request<any>('/devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==========================================
  // GEOFENCES (PASTURES)
  // ==========================================
  public static async listGeofences() {
    return this.request<any[]>('/geofences');
  }

  public static async createGeofence(data: { name: string; description?: string; color?: string; polygonJson: any }) {
    return this.request<any>('/geofences', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==========================================
  // ALERTS
  // ==========================================
  public static async listAlerts(filters?: { status?: string; type?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.type) params.append('type', filters.type);

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<any[]>(`/alerts${query}`);
  }

  public static async getAlertStats() {
    return this.request<{ activeTotal: number; activeBreaches: number; lowBatteries: number }>('/alerts/stats');
  }

  public static async resolveAlert(id: string) {
    return this.request<any>(`/alerts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'RESOLVED' }),
    });
  }

  // ==========================================
  // CAMERA (ESP32-CAM)
  // ==========================================
  public static async listSnapshots(animalId?: string) {
    const query = animalId ? `?animalId=${animalId}` : '';
    return this.request<any[]>(`/camera/snapshots${query}`);
  }

  public static async requestPhoto(deviceId: string) {
    return this.request<{ success: boolean; commandId: string; message: string }>('/camera/request-photo', {
      method: 'POST',
      body: JSON.stringify({ deviceId, resolution: 'SVGA' }),
    });
  }

  // ==========================================
  // ANALYTICS OVERVIEW
  // ==========================================
  public static async getOverview() {
    return this.request<{
      stats: {
        totalAnimals: number;
        insideGeofence: number;
        outsideGeofence: number;
        totalDevices: number;
        onlineDevices: number;
        offlineDevices: number;
        lowBatteryDevices: number;
        activeAlertsCount: number;
      };
      speciesBreakdown: Record<string, number>;
      recentAlerts: any[];
      liveAnimals: any[];
    }>('/analytics/overview');
  }

  // ==========================================
  // MOCK & LIVE TESTING CONTROLS
  // ==========================================
  public static async injectTelemetry(data: {
    animalId: string;
    latitude: number;
    longitude: number;
    battery?: number;
    accuracy?: number;
  }) {
    return this.request<any>('/mock/inject-telemetry', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async simulateBreach(animalId: string) {
    return this.request<any>('/mock/simulate-breach', {
      method: 'POST',
      body: JSON.stringify({ animalId }),
    });
  }

  public static async simulateReturn(animalId: string) {
    return this.request<any>('/mock/simulate-return', {
      method: 'POST',
      body: JSON.stringify({ animalId }),
    });
  }

  public static async injectPhoto(animalId: string) {
    return this.request<any>('/mock/inject-photo', {
      method: 'POST',
      body: JSON.stringify({ animalId }),
    });
  }
}

