import { Animal, Collar, AlertItem, GeofencePen } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export class QamqorApiClient {
  private token: string | null = null;

  setAuthToken(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async getAnimals(): Promise<Animal[]> {
    return this.request<Animal[]>('/animals');
  }

  async getCollars(): Promise<Collar[]> {
    return this.request<Collar[]>('/devices');
  }

  async getGeofences(): Promise<GeofencePen[]> {
    return this.request<GeofencePen[]>('/geofences');
  }

  async getAlerts(): Promise<AlertItem[]> {
    return this.request<AlertItem[]>('/alerts');
  }

  async triggerActuator(deviceId: string, command: { sound?: boolean; vibrate?: boolean; shock?: boolean }) {
    return this.request('/device/trigger', {
      method: 'POST',
      body: JSON.stringify({ deviceId, ...command }),
    });
  }

  async pairCollar(deviceId: string, animalId: string) {
    return this.request(`/animals/${animalId}/assign-collar`, {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
  }
}

export const api = new QamqorApiClient();

