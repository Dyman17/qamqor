import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FarmsService } from '../farms/farms.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { SlidingWindowLimiter } from '../common/rate-limit';
import { loadAppConfig } from '../config/config';
import { ANIMAL_INCLUDE, AnimalDto, toAnimalDto } from '../animals/mappers';
import { DemoDataService } from './demo-data.service';
import { SimulatorService } from './simulator.service';
import { penGeometryOf } from './pen-cache';
import { PenGeometry, Pt } from './geometry';
import { DataModeName, SimEvent } from './dto/simulation.dto';

export const MANUAL_CALLS_PER_MIN = 60;
export const DEFAULT_AUTO_HOURS = 2;

export interface SimulationDto {
  dataMode: DataModeName;
  /** AUTO and before the planned stop. */
  running: boolean;
  speed: number;
  herd: number;
  until: string | null;
  demo: { animals: number; alerts: number };
  /** DEMO_MODES_ENABLED. */
  enabled: boolean;
}

/** What the collar would have received for the manual ping. */
export interface CollarResponseDto {
  zone: string;
  inFence: boolean | null;
  distanceToBorderMeters: number | null;
  sound: boolean;
  vibrate: boolean;
  toneFrequencyHz: number;
  suppressedBy: 'SIGNAL_LIMIT' | null;
}

@Injectable()
export class SimulationService {
  /** Manual calls: 60 per minute per user. */
  readonly limiter = new SlidingWindowLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly farms: FarmsService,
    private readonly telemetry: TelemetryService,
    private readonly demo: DemoDataService,
    private readonly simulator: SimulatorService,
  ) {}

  // ---------- state ----------

  private enabled(): boolean {
    return loadAppConfig(process.env).demoModesEnabled;
  }

  /** DEMO_MODES_ENABLED=false: every simulation route except the state read answers 404. */
  private assertEnabled(): void {
    if (!this.enabled()) throw new NotFoundException('Демо-режимы отключены');
  }

  private async toDto(farm: any): Promise<SimulationDto> {
    const now = Date.now();
    const until = farm.simUntil ? new Date(farm.simUntil) : null;
    return {
      dataMode: farm.dataMode ?? 'REAL',
      running: farm.dataMode === 'AUTO' && !!until && until.getTime() > now,
      speed: farm.simSpeed ?? 1,
      herd: farm.simHerd ?? 8,
      until: farm.dataMode === 'AUTO' && until ? until.toISOString() : null,
      demo: farm.dataMode === 'REAL' ? { animals: 0, alerts: 0 } : await this.demo.counts(farm.id),
      enabled: this.enabled(),
    };
  }

  private async farmOf(farmId: string) {
    return this.prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
  }

  /** GET /farms/:id/simulation (W). Also records that somebody is watching (see SimulatorService). */
  async getState(userId: string, farmId: string): Promise<SimulationDto> {
    const m = await this.farms.requireMember(userId, farmId);
    let farm: any = m.farm;
    if (!this.enabled()) return this.toDto(farm);
    this.simulator.markViewed(farmId);
    if (farm.dataMode === 'MANUAL') {
      // Idle farms have no tick: trim their demo history here (throttled, 24 h TTL).
      await this.simulator.cleanupIdle(farmId).catch(() => undefined);
    }
    if (farm.dataMode === 'AUTO' && (!farm.simUntil || new Date(farm.simUntil).getTime() <= Date.now())) {
      await this.simulator.autoStop(farmId);
      farm = await this.farmOf(farmId);
    }
    return this.toDto(farm);
  }

  // ---------- mode switching (owner) ----------

  async setMode(userId: string, farmId: string, mode: DataModeName): Promise<SimulationDto> {
    const m = await this.farms.requireOwner(userId, farmId);
    this.assertEnabled();
    const farm: any = m.farm;
    if (farm.dataMode === mode) return this.toDto(farm);

    if (mode === 'AUTO') return this.begin(farm, {});

    this.simulator.forgetFarm(farmId);
    if (mode === 'REAL') {
      // Hold the tick lease so a running tick cannot re-create demo rows during or after the purge.
      if (!(await this.simulator.acquireLease(farmId))) {
        throw new ConflictException('Симуляция занята, повторите через несколько секунд');
      }
      try {
        await this.prisma.farm.update({ where: { id: farmId }, data: { dataMode: 'REAL', simUntil: null } });
        // The demo data is removed; real animals, collars, pens and alerts are not touched.
        await this.demo.purge(farmId);
      } finally {
        await this.simulator.releaseLease(farmId);
      }
      return this.toDto(await this.farmOf(farmId));
    }
    const updated = await this.prisma.farm.update({
      where: { id: farmId },
      data: { dataMode: mode, simUntil: null, simLeaseUntil: null },
    });
    return this.toDto(updated);
  }

  private async begin(farm: any, p: { speed?: number; herd?: number; hours?: number }): Promise<SimulationDto> {
    const speed = p.speed ?? farm.simSpeed ?? 1;
    const herd = p.herd ?? farm.simHerd ?? 8;
    const until = new Date(Date.now() + (p.hours ?? DEFAULT_AUTO_HOURS) * 3600_000);
    // The herd is built first and the farm switches to AUTO only afterwards: a failure leaves the mode as it was.
    if (!(await this.simulator.acquireLease(farm.id))) {
      throw new ConflictException('Симуляция занята, повторите через несколько секунд');
    }
    let updated: any;
    try {
      if (p.herd !== undefined) await this.demo.trimHerd(farm.id, herd);
      await this.demo.ensureHerd(farm.id, herd);
      updated = await this.prisma.farm.update({
        where: { id: farm.id },
        data: { dataMode: 'AUTO', simSpeed: speed, simHerd: herd, simUntil: until },
      });
    } finally {
      await this.simulator.releaseLease(farm.id);
    }
    this.simulator.beginFarm(farm.id);
    this.simulator.markViewed(farm.id);
    return this.toDto(updated);
  }

  async start(userId: string, farmId: string, p: { speed?: number; herd?: number; hours?: number }) {
    const m = await this.farms.requireOwner(userId, farmId);
    this.assertEnabled();
    return this.begin(m.farm, p);
  }

  async stop(userId: string, farmId: string): Promise<SimulationDto> {
    const m = await this.farms.requireOwner(userId, farmId);
    this.assertEnabled();
    if (m.farm.dataMode === 'REAL') throw new ConflictException('Симуляция не запущена: включён режим «Реальные данные»');
    this.simulator.forgetFarm(farmId);
    const updated = await this.prisma.farm.update({
      where: { id: farmId },
      data: { dataMode: 'MANUAL', simUntil: null, simLeaseUntil: null },
    });
    return this.toDto(updated);
  }

  async reset(userId: string, farmId: string): Promise<SimulationDto> {
    const m = await this.farms.requireOwner(userId, farmId);
    this.assertEnabled();
    if (m.farm.dataMode === 'REAL') throw new ConflictException('Сбрасывать нечего: включён режим «Реальные данные»');
    await this.demo.reset(farmId);
    // The scenario starts over (scripted opening) when it is running.
    if (m.farm.dataMode === 'AUTO') this.simulator.beginFarm(farmId);
    return this.toDto(await this.farmOf(farmId));
  }

  async setSpeed(userId: string, farmId: string, speed?: number): Promise<SimulationDto> {
    const m = await this.farms.requireOwner(userId, farmId);
    this.assertEnabled();
    if (m.farm.dataMode === 'REAL') throw new ConflictException('Симуляция не запущена: включён режим «Реальные данные»');
    if (speed === undefined) return this.toDto(m.farm);
    const updated = await this.prisma.farm.update({ where: { id: farmId }, data: { simSpeed: speed } });
    return this.toDto(updated);
  }

  // ---------- manual input (owner, MANUAL mode) ----------

  private limit(userId: string) {
    const r = this.limiter.consume(`sim:${userId}`, MANUAL_CALLS_PER_MIN, 60_000);
    if (!r.allowed) {
      throw new HttpException(
        { statusCode: 429, code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже', retryAfterSec: r.retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Owner + enabled + MANUAL mode (REAL and AUTO -> 409) + rate limit. */
  private async manualFarm(userId: string, farmId: string) {
    const m = await this.farms.requireOwner(userId, farmId);
    this.assertEnabled();
    this.limit(userId);
    const mode = m.farm.dataMode;
    if (mode === 'REAL') throw new ConflictException('Включён режим «Реальные данные»: ручной ввод доступен только в ручном режиме');
    if (mode === 'AUTO') throw new ConflictException('Идёт симуляция: остановите её, чтобы вводить данные вручную');
    return m.farm;
  }

  /** Only demo animals with a simulated collar are reachable; anything else is 404. */
  private async demoAnimal(farmId: string, animalId: string) {
    const animal: any = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId, isDemo: true },
      include: { device: true, activeGeofence: true },
    });
    if (!animal || !animal.device || !animal.device.isSimulated) throw new NotFoundException('Демо-животное не найдено');
    return animal;
  }

  async createAnimal(userId: string, farmId: string, dto: { name?: string; species?: string }): Promise<AnimalDto> {
    await this.manualFarm(userId, farmId);
    const { id } = await this.demo.createAnimal(farmId, dto);
    const row = await this.prisma.animal.findFirst({ where: { id }, include: ANIMAL_INCLUDE });
    return toAnimalDto(row);
  }

  /** The ping goes through TelemetryService, exactly like a real collar's. */
  private async ping(
    animal: any,
    pos: { latitude: number; longitude: number },
    accuracy: number,
    speedKmh?: number,
  ): Promise<CollarResponseDto> {
    const device: any = await this.prisma.device.findUnique({
      where: { id: animal.device.id },
      include: { farm: true, animal: { include: { activeGeofence: true } } },
    });
    const last = device?.animal?.lastSeenAt ? new Date(device.animal.lastSeenAt).getTime() : 0;
    const ts = new Date(Math.max(Date.now(), last + 1));
    const res = await this.telemetry.processDeviceTelemetry(device, {
      deviceId: device.deviceId,
      timestamp: ts.toISOString(),
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracy,
      signal: -70,
      ...(speedKmh !== undefined && { speedKmh }),
    } as any);
    return {
      zone: res.zone,
      inFence: res.inFence,
      distanceToBorderMeters: res.distanceToBorderMeters,
      sound: res.sound,
      vibrate: res.vibrate,
      toneFrequencyHz: res.toneFrequencyHz,
      suppressedBy: res.suppressedBy ?? null,
    };
  }

  async simulateTelemetry(
    userId: string,
    farmId: string,
    dto: { animalId: string; lat: number; lng: number; accuracyM?: number; speedKmh?: number },
  ): Promise<CollarResponseDto> {
    await this.manualFarm(userId, farmId);
    const animal = await this.demoAnimal(farmId, dto.animalId);
    return this.ping(animal, { latitude: dto.lat, longitude: dto.lng }, dto.accuracyM ?? 5, dto.speedKmh);
  }

  async simulateEvent(
    userId: string,
    farmId: string,
    dto: { animalId: string; event: SimEvent },
  ): Promise<CollarResponseDto | { ok: true }> {
    await this.manualFarm(userId, farmId);
    const animal = await this.demoAnimal(farmId, dto.animalId);

    if (dto.event === 'COLLAR_OFFLINE') {
      // lastHeartbeatAt is moved back past the threshold and the real offline watcher raises DEVICE_OFFLINE.
      const locked = await this.simulator.forceOffline(animal.device);
      if (!locked) throw new ConflictException('Проверка связи занята, повторите через несколько секунд');
      return { ok: true };
    }

    const geom: PenGeometry | null = penGeometryOf(animal.activeGeofence);
    if (!geom) throw new ConflictException('У животного нет загона с корректной границей');
    const cur: Pt =
      animal.lastLatitude != null && animal.lastLongitude != null
        ? geom.toLocal(animal.lastLatitude, animal.lastLongitude)
        : geom.bestInterior();

    let target: Pt | null = cur;
    let accuracy = 5;
    let speedKmh: number | undefined;
    switch (dto.event) {
      case 'BREACH':
        target = geom.outsidePoint(cur, 30, 15, 60);
        speedKmh = 3;
        break;
      case 'ESCAPE':
        target = null;
        for (const d of [150, 250, 400]) {
          target = geom.outsidePoint(cur, d, 110, Infinity);
          if (target) break;
        }
        speedKmh = 5;
        break;
      case 'RETURN':
        target = geom.bestInterior();
        break;
      case 'GPS_LOST':
        accuracy = 80;
        break;
      case 'COLLAR_ONLINE':
        break;
    }
    if (!target) throw new ConflictException('Для формы этого загона не удалось подобрать точку');
    return this.ping(animal, geom.toGeo(target), accuracy, speedKmh);
  }
}
