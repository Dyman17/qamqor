import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
  MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GeofenceService } from '../geofences/geofence.service';
import { AlertsService } from '../alerts/alerts.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';
import { DeviceStatus } from '@qamqor/shared';
import { DEVICE_AUTH_ERROR } from '../devices/device-auth.guard';
import { SignalsService } from '../signals/signals.service';
import { smoothHeartRate, computePulseThreat, PulseThreatDto } from '../animals/pulse-analysis';
import { Subject, Observable, interval, merge } from 'rxjs';
import { filter, map, startWith } from 'rxjs/operators';
import { LiveViewersService, MAX_STREAMS_PER_USER, tooManyStreams } from './live-viewers.service';
import { DEFAULT_SIGNAL_COOLDOWN_SEC } from '../signals/signals.service';

export type ZoneName = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';

/** A stored pulse older than this is not shown as the current one. */
export const STORED_HEART_RATE_MAX_AGE_MS = 120_000;
/** The device row (status, heartbeat, signal) is rewritten at most this often unless the status changes. */
export const DEVICE_WRITE_MIN_MS = 10_000;
/** While an animal stays outside / has an unreliable fix, the alert is re-checked at most this often. */
export const ALERT_RECHECK_MS = 15_000;
/** Interval of the SSE keepalive event. */
const KEEPALIVE_MS = 15_000;

/**
 * Per-device state of the last pings, in process memory (single instance). The telemetry table has no
 * zone column, so "the zone changed" can only be known from here; after a restart the first ping of a
 * device simply counts as a change and is stored.
 */
interface DeviceTrack {
  seenAt: number;
  /** Zone of the last processed ping that had a fix. */
  zone: ZoneName | null;
  /** The last ping with a fix was unreliable (a GPS_LOST alert may be open). */
  lowAccuracy: boolean;
  /** The last ping carried a pulse. */
  hadHeartRate: boolean;
  /** Server time (ms) the last Telemetry row was stored. */
  storedAt: number;
  /** Server time (ms) the breach / GPS_LOST alert was last looked at. */
  alertCheckedAt: number;
}

export interface TelemetryStreamEvent {
  /** Farm of the device; unclaimed devices (null) are never streamed. */
  farmId: string | null;
  deviceId: string;
  code: string | null;
  animalId: string | null;
  animalName?: string | null;
  heartRate: number | null;
  lastHeartRateAt: string | null;
  pulseThreat: PulseThreatDto | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  zone: ZoneName;
  inFence: boolean | null;
  distanceToBorderMeters: number | null;
  sound: boolean;
  vibrate: boolean;
  lastSeenAt: string;
  serverTime: string;
  rssi: number | null;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly telemetryEvents$ = new Subject<TelemetryStreamEvent>();
  private readonly track = new Map<string, DeviceTrack>();
  private trackCalls = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geofenceService: GeofenceService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
    private readonly signals: SignalsService,
    private readonly live: LiveViewersService = new LiveViewersService(),
  ) {}

  /**
   * Stream of real-time telemetry events of ONE farm (unclaimed devices are never included).
   * Can be further filtered by device code/id or animal id.
   */
  getTelemetryStream(farmId: string, code?: string, animalId?: string): Observable<TelemetryStreamEvent> {
    return this.telemetryEvents$.asObservable().pipe(
      filter((ev) => {
        if (!farmId || ev.farmId !== farmId) return false;
        if (code && ev.code !== code && ev.deviceId !== code) return false;
        if (animalId && ev.animalId !== animalId) return false;
        return true;
      }),
    );
  }

  /**
   * The SSE stream of a farm for the web client. Counts as a live viewer of the farm (collars of a live
   * farm are told to ping often, see nextInterval) until the client disconnects. Throws 429 when the user
   * already holds the maximum of open streams. Emits a keepalive immediately and every 15 s.
   */
  openStream(args: { userId: string; farmId: string; code?: string; animalId?: string }): Observable<MessageEvent> {
    const { userId, farmId } = args;
    if (this.live.userStreams(userId) >= MAX_STREAMS_PER_USER) throw tooManyStreams();
    const keepalive = (): MessageEvent => ({ data: { type: 'keepalive', serverTime: new Date().toISOString() } });
    return new Observable<MessageEvent>((subscriber) => {
      const releaseUser = this.live.acquireUser(userId, MAX_STREAMS_PER_USER);
      if (!releaseUser) {
        subscriber.error(tooManyStreams());
        return undefined;
      }
      const releaseFarm = this.live.join(farmId);
      const inner = merge(
        interval(KEEPALIVE_MS).pipe(map(keepalive)),
        this.getTelemetryStream(farmId, args.code, args.animalId).pipe(
          map(({ farmId: _farmId, ...ev }): MessageEvent => ({ data: { type: 'telemetry', ...ev } })),
        ),
      )
        .pipe(startWith(keepalive()))
        .subscribe(subscriber);
      return () => {
        inner.unsubscribe();
        releaseFarm();
        releaseUser();
      };
    });
  }

  private num(key: string, def: number): number {
    const n = parseInt(this.configService.get<string>(key, String(def)), 10);
    return Number.isInteger(n) && n > 0 ? n : def;
  }

  /** Like num, but 0 is a valid value. */
  private numNonNeg(key: string, def: number): number {
    const raw = this.configService.get<string>(key, String(def));
    const n = Number(raw);
    return raw !== '' && raw != null && Number.isInteger(n) && n >= 0 ? n : def;
  }

  private pruneTrack(nowMs: number) {
    if (++this.trackCalls % 500 !== 0 && this.track.size < 5000) return;
    for (const [k, v] of this.track) if (nowMs - v.seenAt > 3600_000) this.track.delete(k);
  }

  /**
   * Handles a ping from an already authenticated device (see DeviceAuthGuard).
   * Devices are never created here.
   *
   * Fail-closed: without a usable boundary, or with an unreliable fix, the zone is UNKNOWN,
   * every actuator is off and the position is still stored. The impulse is never produced.
   */
  async processDeviceTelemetry(
    device: any,
    dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    if (!device || device.deviceId !== dto.deviceId) {
      throw new UnauthorizedException(DEVICE_AUTH_ERROR);
    }

    // Anti-replay and timestamp window
    const hasFix = typeof dto.latitude === 'number' && typeof dto.longitude === 'number';
    const lat = dto.latitude as number;
    const lng = dto.longitude as number;
    const acc = dto.accuracy as number;
    // A pulse-only ping (no GPS fix, e.g. indoors) may omit the timestamp: server time is used.
    const now0 = new Date();
    const pingTime = dto.timestamp ? new Date(dto.timestamp) : now0;
    const now = new Date();
    const nowMs = now.getTime();
    const maxAgeMs = this.num('TELEMETRY_MAX_AGE_SEC', 600) * 1000;
    const maxFutureMs = this.num('TELEMETRY_MAX_FUTURE_SEC', 120) * 1000;
    const skew = pingTime.getTime() - nowMs; // negative = in the past
    if (Number.isNaN(skew) || skew < -maxAgeMs || skew > maxFutureMs) {
      throw new BadRequestException('Telemetry timestamp is invalid or outside the acceptable time window.');
    }

    const st = this.track.get(device.deviceId);
    this.pruneTrack(nowMs);

    // A retried ping (same device + timestamp) is answered but not counted again.
    const duplicate = !!(await this.prisma.telemetry.findFirst({
      where: { deviceId: device.deviceId, timestamp: pingTime },
      select: { id: true },
    }));
    // An older or equal timestamp must not move the animal backwards.
    const stale = hasFix && !!(device.animal?.lastSeenAt && pingTime.getTime() <= new Date(device.animal.lastSeenAt).getTime());

    const prevOutside: boolean = device.animal?.isOutsideGeofence ?? false;
    let isOutside: boolean = prevOutside;
    let zone: ZoneName = 'UNKNOWN';
    let inFence: boolean | null = null;
    let distanceToBorderMeters: number | null = null;
    let toneFrequencyHz = 0;
    let sound = false;
    let vibrate = false;
    let unknownReason: string | null = hasFix ? 'NO_BOUNDARY' : 'NO_FIX';
    let suppressedBy: 'SIGNAL_LIMIT' | null = null;
    let lowAccuracy = false;
    let alertCheckedAt = st?.alertCheckedAt ?? 0;
    let outside = false; // outside on a fresh (non-stale) ping: emergency cadence

    const claimed = !!device.farmId;
    const normalInterval = this.num('NORMAL_PING_INTERVAL_SEC', 300);
    const emergencyInterval = this.num('EMERGENCY_PING_INTERVAL_SEC', 60);
    const liveInterval = Math.min(Math.max(this.num('LIVE_PING_INTERVAL_SEC', 1), 1), 60);
    const unclaimedInterval = this.num('UNCLAIMED_PING_INTERVAL_SEC', 30);
    const lingerSec = this.numNonNeg('LIVE_LINGER_SEC', 120);
    const storeMinMs = this.numNonNeg('TELEMETRY_STORE_MIN_SEC', 10) * 1000;
    const cooldownSec = this.numNonNeg('SIGNAL_COOLDOWN_SEC', DEFAULT_SIGNAL_COOLDOWN_SEC);

    const rawHr: number | null = typeof dto.heartRate === 'number' ? dto.heartRate : null;
    const hr: number | null = rawHr !== null ? smoothHeartRate(device.animal?.lastHeartRate, rawHr) : null;
    const animal = device.animal;
    const polygon = animal?.activeGeofence?.polygonJson ?? null;

    if (animal && hasFix) {
      const evaluation = this.geofenceService.evaluateLocation(
        {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          speed: dto.speedKmh,
        },
        polygon,
      );
      zone = evaluation.zone;
      unknownReason = evaluation.reason;
      distanceToBorderMeters = evaluation.distanceMeters;
      lowAccuracy = zone === 'UNKNOWN' && evaluation.reason === 'LOW_ACCURACY';

      if (zone !== 'UNKNOWN') {
        toneFrequencyHz = evaluation.toneFrequencyHz;
        inFence = !(zone === 'RED' || zone === 'ESCAPE');
        isOutside = !inFence;

        // GREEN: none; YELLOW: sound; ORANGE/RED: sound+vibration; ESCAPE: none (anti-panic).
        sound = zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED';
        vibrate = zone === 'ORANGE' || zone === 'RED';

        // A GPS_LOST alert can only be open if the last fix was unreliable (or nothing is known yet).
        if (device.farmId && !stale && (!st || st.lowAccuracy)) {
          await this.alertsService.resolveGpsLost(animal.id);
        }

        if (stale || duplicate) {
          // A stale or retried ping never delivers (or records) a signal.
          sound = false;
          vibrate = false;
          toneFrequencyHz = 0;
        } else if (device.farmId) {
          // Signals are episodic (cooldown per kind) and subject to the daily limits: a level that
          // reached its limit is suppressed and an alert is raised. A signal inside the cooldown is
          // simply not repeated (not a suppression).
          const limited = await this.signals.applyLimits({
            farmId: device.farmId,
            timezone: device.farm?.timezone ?? 'Asia/Aqtau',
            animal: { id: animal.id, name: animal.name, isDemo: !!animal.isDemo },
            deviceId: device.deviceId,
            sound,
            vibrate,
            now,
            record: true,
            cooldownSec,
          });
          if (limited.suppressed) suppressedBy = 'SIGNAL_LIMIT';
          if (!limited.sound) toneFrequencyHz = 0;
          sound = limited.sound;
          vibrate = limited.vibrate;
        }

        if (stale) {
          // out-of-order ping: no alert changes
        } else if (isOutside) {
          // The animal escaped: tighter ping interval (min with the live one, below).
          outside = true;
          if (device.farmId && (!prevOutside || !st || nowMs - alertCheckedAt >= ALERT_RECHECK_MS)) {
            alertCheckedAt = nowMs;
            await this.alertsService.triggerGeofenceBreach({
              farmId: device.farmId,
              animalId: animal.id,
              animalName: animal.name,
              deviceId: device.deviceId,
              latitude: lat,
              longitude: lng,
              isDemo: !!animal.isDemo,
              freshBreach: !prevOutside,
            });
          }
        } else if (prevOutside && device.farmId) {
          // The animal is back in the zone
          await this.alertsService.resolveGeofenceBreach({
            farmId: device.farmId,
            animalId: animal.id,
            animalName: animal.name,
            deviceId: device.deviceId,
            latitude: lat,
            longitude: lng,
            isDemo: !!animal.isDemo,
          });
        }
      } else if (lowAccuracy && device.farmId && !stale) {
        if (!st || !st.lowAccuracy || nowMs - alertCheckedAt >= ALERT_RECHECK_MS) {
          alertCheckedAt = nowMs;
          await this.alertsService.triggerGpsLost({
            farmId: device.farmId,
            animalId: animal.id,
            animalName: animal.name,
            deviceId: device.deviceId,
            isDemo: !!animal.isDemo,
          });
        }
      }

      if (!stale) {
        if (lowAccuracy) {
          // The firmware repeats the LAST KNOWN position with accuracy 999 when it loses the fix: it is not
          // a new position, so the animal's position and lastSeenAt stay as they were. Only the pulse is kept.
          if (hr !== null) {
            await this.prisma.animal.update({
              where: { id: animal.id },
              data: { lastHeartRate: hr, lastHeartRateAt: pingTime },
            });
          }
        } else {
          // The last known position is stored on every valid ping, whatever the zone.
          await this.prisma.animal.update({
            where: { id: animal.id },
            data: {
              lastLatitude: lat,
              lastLongitude: lng,
              lastAccuracy: acc,
              lastSeenAt: pingTime,
              isOutsideGeofence: isOutside,
              ...(hr !== null && { lastHeartRate: hr, lastHeartRateAt: pingTime }),
            },
          });
        }
      }
    }

    // Pulse-only ping: keep the latest pulse, no zone logic, no signals, no GPS alerts.
    if (animal && !hasFix && hr !== null) {
      const prev = animal.lastHeartRateAt ? new Date(animal.lastHeartRateAt).getTime() : 0;
      if (pingTime.getTime() >= prev) {
        await this.prisma.animal.update({ where: { id: animal.id }, data: { lastHeartRate: hr, lastHeartRateAt: pingTime } });
      }
    }

    // Device status: last contact is the server receive time. Written when the status changes or at most
    // every DEVICE_WRITE_MIN_MS (a 1 s ping loop must not rewrite the row every second).
    const lastBeat = device.lastHeartbeatAt ? new Date(device.lastHeartbeatAt).getTime() : 0;
    const wasOffline = device.status === DeviceStatus.OFFLINE;
    if (device.status !== DeviceStatus.ONLINE || nowMs - lastBeat >= DEVICE_WRITE_MIN_MS) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: {
          signal: dto.signal ?? null,
          status: DeviceStatus.ONLINE,
          lastHeartbeatAt: now,
        },
      });
    }

    // The collar is heard again: close its DEVICE_OFFLINE alert. An alert can only be open if the offline
    // watcher marked the device OFFLINE (or, for alerts raised before that mark existed, the silence
    // lasted longer than the offline threshold).
    const offlineThresholdMs = this.num('OFFLINE_AFTER_MISSED_PINGS', 3) * normalInterval * 1000;
    if (animal && device.farmId && (wasOffline || (lastBeat > 0 && nowMs - lastBeat > offlineThresholdMs))) {
      await this.alertsService.restoreDevice({
        farmId: device.farmId,
        animalId: animal.id,
        animalName: animal.name,
        deviceId: device.deviceId,
        isDemo: !!animal.isDemo,
      });
    }

    // Record a Telemetry point only when it adds information: the zone changed, a breach / return /
    // GPS_LOST transition happened, a pulse appeared, or TELEMETRY_STORE_MIN_SEC passed since the last row.
    // (The live stream below is broadcast on every ping regardless.)
    const fresh = hasFix && !stale;
    const changed =
      fresh &&
      !!st &&
      (st.zone !== zone || (!!animal && isOutside !== prevOutside) || st.lowAccuracy !== lowAccuracy);
    const heartRateAppeared = hr !== null && !(st?.hadHeartRate);
    const store = !duplicate && (!st || nowMs - st.storedAt >= storeMinMs || changed || heartRateAppeared);
    if (store) {
      await this.prisma.telemetry.create({
        data: {
          deviceId: device.deviceId,
          animalId: animal?.id,
          latitude: hasFix ? lat : null,
          longitude: hasFix ? lng : null,
          accuracy: hasFix ? acc : null,
          signal: dto.signal,
          heartRate: hr,
          satellites: dto.satellites ?? null,
          isOutsideGeofence: isOutside,
          timestamp: pingTime,
        },
      });
    }

    this.track.set(device.deviceId, {
      seenAt: nowMs,
      zone: fresh ? zone : st?.zone ?? null,
      lowAccuracy: fresh ? lowAccuracy : st?.lowAccuracy ?? false,
      hadHeartRate: hr !== null,
      storedAt: store ? nowMs : st?.storedAt ?? 0,
      alertCheckedAt,
    });

    // Ping cadence: unclaimed -> slow; a claimed collar of a farm somebody watches (live) -> fast;
    // otherwise normal. An escaped animal gets the emergency interval, but never longer than the live one.
    const baseInterval = !claimed
      ? unclaimedInterval
      : this.live.isLive(device.farmId, lingerSec)
        ? liveInterval
        : normalInterval;
    const nextInterval = outside ? Math.min(baseInterval, emergencyInterval) : baseInterval;

    let warningMessage: string;
    switch (zone) {
      case 'GREEN':
        warningMessage = 'Zone GREEN: safe grazing. No signals.';
        break;
      case 'YELLOW':
        warningMessage = `Zone YELLOW: warning, ${distanceToBorderMeters} m to the border. Sound signal (${toneFrequencyHz} Hz).`;
        break;
      case 'ORANGE':
        warningMessage = `Zone ORANGE: near the border (${distanceToBorderMeters} m). Sound (${toneFrequencyHz} Hz) and vibration.`;
        break;
      case 'RED':
        warningMessage = `Zone RED: outside the border (${distanceToBorderMeters} m). Sound (${toneFrequencyHz} Hz) and vibration.`;
        break;
      case 'ESCAPE':
        warningMessage = `Zone ESCAPE (${distanceToBorderMeters} m outside): signals disabled to avoid panic.`;
        break;
      default:
        warningMessage =
          unknownReason === 'NO_FIX'
            ? 'Zone UNKNOWN: no GPS fix. No signals.'
            : unknownReason === 'LOW_ACCURACY'
            ? 'Zone UNKNOWN: GPS fix is not reliable. No signals.'
            : unknownReason === 'INVALID_BOUNDARY'
              ? 'Zone UNKNOWN: the boundary is invalid. No signals.'
              : 'Zone UNKNOWN: no boundary is set for this animal. No signals.';
    }

    if (!device.farmId) warningMessage = 'Device not claimed yet';

    if (suppressedBy) warningMessage += ' Some signals are suppressed by the daily limit.';

    // Deliver at most one queued test signal per ping (once only).
    let command: { id: string; type: 'TEST_SOUND' | 'TEST_SPEAKER' | 'TEST_BUZZER' | 'TEST_VIBRATION' } | undefined;
    const pending = await this.prisma.deviceCommand.findFirst({
      where: { deviceId: device.deviceId, status: 'PENDING', command: { in: ['TEST_SOUND', 'TEST_SPEAKER', 'TEST_BUZZER', 'TEST_VIBRATION'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (pending) {
      const claimedCmd = await this.prisma.deviceCommand.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { status: 'EXECUTED', executedAt: new Date() },
      });
      if (claimedCmd.count === 1) {
        command = { id: pending.id, type: pending.command as any };
      }
    }

    try {
      // The pulse of this ping, or the stored one while it is still fresh (<= 120 s); never an old value.
      let streamHr: number | null = hr;
      let streamHrAt: string | null = hr != null ? pingTime.toISOString() : null;
      if (hr == null && device.animal?.lastHeartRate != null && device.animal.lastHeartRateAt) {
        const storedAt = new Date(device.animal.lastHeartRateAt).getTime();
        if (nowMs - storedAt <= STORED_HEART_RATE_MAX_AGE_MS) {
          streamHr = device.animal.lastHeartRate;
          streamHrAt = new Date(storedAt).toISOString();
        }
      }
      const pulseThreat = computePulseThreat(device.animal?.species, streamHr);
      this.telemetryEvents$.next({
        farmId: device.farmId ?? null,
        deviceId: device.deviceId,
        code: device.code ?? null,
        animalId: device.animal?.id || device.animalId || null,
        animalName: device.animal?.name || null,
        heartRate: streamHr,
        lastHeartRateAt: streamHrAt,
        pulseThreat,
        latitude: typeof dto.latitude === 'number' && isFinite(dto.latitude) ? dto.latitude : null,
        longitude: typeof dto.longitude === 'number' && isFinite(dto.longitude) ? dto.longitude : null,
        accuracyM: dto.accuracy ?? null,
        zone,
        inFence,
        distanceToBorderMeters,
        sound,
        vibrate,
        lastSeenAt: pingTime.toISOString(),
        serverTime: now.toISOString(),
        rssi: dto.signal ?? null,
      });
    } catch (e) {
      this.logger.warn(`Failed to broadcast telemetry event: ${(e as Error).message}`);
    }

    return {
      success: true,
      mode: device.farm?.dataMode === 'AUTO' ? 'AUTO' : device.farm?.dataMode === 'MANUAL' ? 'PILOT' : 'REAL',
      serverTime: now.toISOString(),
      nextInterval,
      configVersion: 1,
      command,
      inFence,
      zone,
      distanceToBorderMeters,
      toneFrequencyHz,
      sound,
      vibrate,
      vibrateDurationMs: vibrate ? 3000 : 0,
      suppressedBy,
      warningMessage,
    };
  }

  /**
   * Latest raw telemetry packets of a device of THIS farm (404 for a foreign or unknown code).
   */
  async getLatestTelemetry(farmId: string, code: string, limit: number = 10) {
    const device: any = await this.prisma.device.findFirst({
      where: { code, farmId },
      include: { animal: true },
    });
    if (!device) throw new NotFoundException('Устройство не найдено');

    const packets = await this.prisma.telemetry.findMany({
      where: { deviceId: device.deviceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const isLive = device.lastHeartbeatAt
      ? Date.now() - new Date(device.lastHeartbeatAt).getTime() < 15000
      : false;

    return {
      success: true,
      code: device.code,
      deviceId: device.deviceId,
      online: isLive,
      lastHeartbeatAt: device.lastHeartbeatAt,
      signalRssi: device.signal ?? null,
      animal: device.animal
        ? {
            id: device.animal.id,
            name: device.animal.name,
            tag: device.animal.tagNumber,
            lastHeartRate: device.animal.lastHeartRate,
            lastHeartRateAt: device.animal.lastHeartRateAt,
            lastLatitude: device.animal.lastLatitude,
            lastLongitude: device.animal.lastLongitude,
          }
        : null,
      totalRecentPackets: packets.length,
      packets: packets.map((p) => ({
        time: p.createdAt,
        heartRate: p.heartRate,
        latitude: p.latitude,
        longitude: p.longitude,
        satellites: p.satellites,
        accuracy: p.accuracy,
        signal: p.signal,
      })),
    };
  }
}
