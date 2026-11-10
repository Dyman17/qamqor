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
import { Subject, Observable, Subscription, interval } from 'rxjs';
import { concatMap, filter, map } from 'rxjs/operators';
import type { CollarControlMode, PositionSource } from '@qamqor/shared';
import { LiveViewersService, MAX_STREAMS_PER_USER, tooManyStreams } from './live-viewers.service';
import { DEFAULT_SIGNAL_COOLDOWN_SEC } from '../signals/signals.service';
import { AUTO_RESET_DATA, isControlModeExpired, leaveGpsManual } from '../devices/control-mode';

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
  /**
   * A GPS_LOST alert may still be open: set by an unreliable fix, cleared only once a reliable fix has
   * actually run resolveGpsLost (whatever its zone, also UNKNOWN / NO_BOUNDARY). Unknown after a restart.
   */
  gpsLostMaybeOpen: boolean;
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
  /** Control mode of the collar (AUTO when unknown). */
  controlMode: CollarControlMode;
  /** MANUAL = the position is the operator's dragged point (GPS_MANUAL), GPS = the collar's own fix. */
  positionSource: PositionSource;
}

/** Severity of a zone for signalling: entering a higher rank is an escalation. */
export function zoneRank(zone: ZoneName | null | undefined): number {
  switch (zone) {
    case 'YELLOW':
      return 1;
    case 'ORANGE':
      return 2;
    case 'RED':
      return 3;
    default:
      return 0; // GREEN, ESCAPE (silent), UNKNOWN, none
  }
}

/**
 * Escalation state of an animal (in process memory): the highest signalling rank reached in the current
 * episode. A new episode starts only after the animal was in GREEN continuously for ESCALATION_RESET_SEC;
 * a single GREEN ping or an UNKNOWN / unreliable ping never resets it, so GPS noise on a zone line cannot
 * re-fire an escalation (which bypasses the cooldown).
 */
interface Episode {
  rank: number;
  greenSince: number | null;
  seenAt: number;
}
export const DEFAULT_ESCALATION_RESET_SEC = 60;

/** A command is re-delivered (same id) until delivered this many times ... */
export const COMMAND_MAX_DELIVERIES = 2;
/** ... or until this long after the first delivery. */
export const COMMAND_REDELIVER_WINDOW_MS = 20_000;

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly telemetryEvents$ = new Subject<TelemetryStreamEvent>();
  private readonly track = new Map<string, DeviceTrack>();
  private readonly episodes = new Map<string, Episode>();
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
   * already holds the maximum of open streams. Emits a keepalive immediately and every 15 s. The stream is
   * ended (completed) when the JWT expires (`expiresAtSec`) and on the first keepalive tick after the user
   * stopped being a member of the farm; the viewer and the stream slot are released either way.
   */
  openStream(args: {
    userId: string;
    farmId: string;
    code?: string;
    animalId?: string;
    /** JWT `exp` (seconds since epoch). */
    expiresAtSec?: number;
  }): Observable<MessageEvent> {
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
      const subs = new Subscription();
      subscriber.next(keepalive());
      subs.add(
        this.getTelemetryStream(farmId, args.code, args.animalId)
          .pipe(map(({ farmId: _farmId, ...ev }): MessageEvent => ({ data: { type: 'telemetry', ...ev } })))
          .subscribe({ next: (m) => subscriber.next(m), error: (e) => subscriber.error(e) }),
      );
      subs.add(
        interval(KEEPALIVE_MS)
          .pipe(concatMap(() => this.stillMember(userId, farmId)))
          .subscribe((member) => {
            if (member) subscriber.next(keepalive());
            else subscriber.complete();
          }),
      );
      let expiryTimer: NodeJS.Timeout | undefined;
      if (typeof args.expiresAtSec === 'number') {
        const ms = Math.min(Math.max(args.expiresAtSec * 1000 - Date.now(), 0), 2 ** 31 - 1);
        expiryTimer = setTimeout(() => subscriber.complete(), ms);
        expiryTimer.unref?.();
      }
      return () => {
        subs.unsubscribe();
        if (expiryTimer) clearTimeout(expiryTimer);
        releaseFarm();
        releaseUser();
      };
    });
  }

  /** Membership re-check of an open stream. A database error does not end the stream. */
  private async stillMember(userId: string, farmId: string): Promise<boolean> {
    try {
      const m = await this.prisma.farmMember.findUnique({
        where: { userId_farmId: { userId, farmId } },
        select: { farmId: true },
      });
      return !!m;
    } catch (e) {
      this.logger.warn(`stream membership check failed: ${(e as Error).message}`);
      return true;
    }
  }

  /** Broadcasts an event to the open streams of its farm (also used by the manual-position route). */
  publishEvent(ev: TelemetryStreamEvent) {
    try {
      this.telemetryEvents$.next(ev);
    } catch (e) {
      this.logger.warn(`Failed to broadcast telemetry event: ${(e as Error).message}`);
    }
  }

  /** The stored pulse of an animal while it is still fresh (<= 120 s), else null. */
  static freshStoredHeartRate(animal: any, nowMs: number): { value: number; at: string } | null {
    if (animal?.lastHeartRate != null && animal.lastHeartRateAt) {
      const at = new Date(animal.lastHeartRateAt).getTime();
      if (nowMs - at <= STORED_HEART_RATE_MAX_AGE_MS) return { value: animal.lastHeartRate, at: new Date(at).toISOString() };
    }
    return null;
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

  /**
   * Updates the episode of the animal with a fresh ping of a KNOWN zone and says whether the zone is a
   * escalation: a rank higher than any reached in the episode. The first ping of an animal (also after a
   * restart) only opens the episode: the normal cooldown applies.
   */
  private episodeEscalation(animalId: string, zone: ZoneName, nowMs: number, resetMs: number): boolean {
    const rank = zoneRank(zone);
    const ep = this.episodes.get(animalId);
    if (!ep) {
      this.episodes.set(animalId, { rank, greenSince: zone === 'GREEN' ? nowMs : null, seenAt: nowMs });
      return false;
    }
    ep.seenAt = nowMs;
    if (zone === 'GREEN') {
      if (ep.greenSince === null) ep.greenSince = nowMs;
      if (nowMs - ep.greenSince >= resetMs) ep.rank = 0;
    } else {
      ep.greenSince = null; // any other known zone interrupts the green stretch
    }
    const escalated = rank > ep.rank;
    if (escalated) ep.rank = rank;
    return escalated;
  }

  private pruneTrack(nowMs: number) {
    if (++this.trackCalls % 500 !== 0 && this.track.size < 5000) return;
    for (const [k, v] of this.track) if (nowMs - v.seenAt > 3600_000) this.track.delete(k);
    for (const [k, v] of this.episodes) if (nowMs - v.seenAt > 3600_000) this.episodes.delete(k);
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

    const animal = device.animal;
    // A MANUAL / GPS_MANUAL mode without operator activity for CONTROL_MODE_TTL_MIN lapses to AUTO (lazily
    // here; the background watcher does the same for silent collars).
    if (
      animal &&
      !device.isSimulated &&
      (device.controlMode === 'GPS_MANUAL' || device.controlMode === 'MANUAL') &&
      isControlModeExpired(device, nowMs, this.num('CONTROL_MODE_TTL_MIN', 120) * 60_000)
    ) {
      await this.prisma.device.update({ where: { id: device.id }, data: AUTO_RESET_DATA });
      if (device.controlMode === 'GPS_MANUAL') {
        // The animal still carries the dragged point: restore the last real fix so this ping is not stale.
        animal.lastSeenAt = await leaveGpsManual(this.prisma, device.deviceId, animal.id);
      }
      Object.assign(device, { ...AUTO_RESET_DATA });
    }
    // The control mode applies to real collars attached to an animal; anything else behaves as AUTO.
    const controlMode: CollarControlMode =
      animal && !device.isSimulated && (device.controlMode === 'GPS_MANUAL' || device.controlMode === 'MANUAL')
        ? device.controlMode
        : 'AUTO';
    const manualGps = controlMode === 'GPS_MANUAL';
    const manualLat: number | null = typeof device.manualLatitude === 'number' ? device.manualLatitude : null;
    const manualLng: number | null = typeof device.manualLongitude === 'number' ? device.manualLongitude : null;
    const hasManual = manualGps && manualLat !== null && manualLng !== null;
    // The position the zone logic works with: the collar's fix, or in GPS_MANUAL the operator's point
    // (accuracy 0, speed 0). The real GPS of a GPS_MANUAL collar is only stored in the telemetry row.
    const evalFix = manualGps ? hasManual : hasFix;
    const eLat = manualGps ? (manualLat as number) : lat;
    const eLng = manualGps ? (manualLng as number) : lng;
    const eAcc = manualGps ? 0 : acc;
    const eSpeed = manualGps ? 0 : dto.speedKmh;

    // A retried ping (same device + timestamp) is answered but not counted again.
    const duplicate = !!(await this.prisma.telemetry.findFirst({
      where: { deviceId: device.deviceId, timestamp: pingTime },
      select: { id: true },
    }));
    // An older or equal timestamp must not move the animal backwards.
    const stale = !manualGps && hasFix && !!(animal?.lastSeenAt && pingTime.getTime() <= new Date(animal.lastSeenAt).getTime());

    const prevOutside: boolean = device.animal?.isOutsideGeofence ?? false;
    let isOutside: boolean = prevOutside;
    let zone: ZoneName = 'UNKNOWN';
    let inFence: boolean | null = null;
    let distanceToBorderMeters: number | null = null;
    let toneFrequencyHz = 0;
    let sound = false;
    let vibrate = false;
    let unknownReason: string | null = evalFix ? 'NO_BOUNDARY' : manualGps ? 'NO_MANUAL_POSITION' : 'NO_FIX';
    let suppressedBy: 'SIGNAL_LIMIT' | null = null;
    let lowAccuracy = false;
    let gpsLostMaybeOpen = st ? st.gpsLostMaybeOpen : true;
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
    const polygon = animal?.activeGeofence?.polygonJson ?? null;

    if (animal && evalFix) {
      const evaluation = this.geofenceService.evaluateLocation(
        {
          latitude: eLat,
          longitude: eLng,
          accuracy: eAcc,
          speed: eSpeed,
        },
        polygon,
      );
      zone = evaluation.zone;
      unknownReason = evaluation.reason;
      distanceToBorderMeters = evaluation.distanceMeters;
      lowAccuracy = !manualGps && zone === 'UNKNOWN' && evaluation.reason === 'LOW_ACCURACY';

      // A GPS_LOST alert can only be open if an earlier fix was unreliable (or nothing is known yet, e.g.
      // after a restart). ANY reliable fix closes it, whatever its zone (also UNKNOWN: no / invalid boundary).
      if (!manualGps && !stale) {
        if (lowAccuracy) {
          gpsLostMaybeOpen = true;
        } else if (evaluation.isReliable && device.farmId && gpsLostMaybeOpen) {
          await this.alertsService.resolveGpsLost(animal.id);
          gpsLostMaybeOpen = false;
        }
      }

      if (zone !== 'UNKNOWN') {
        toneFrequencyHz = evaluation.toneFrequencyHz;
        inFence = !(zone === 'RED' || zone === 'ESCAPE');
        isOutside = !inFence;

        // GREEN: none; YELLOW: sound; ORANGE/RED: sound+vibration; ESCAPE: none (anti-panic).
        sound = zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED';
        vibrate = zone === 'ORANGE' || zone === 'RED';

        const escalation =
          !stale &&
          !duplicate &&
          this.episodeEscalation(
            animal.id,
            zone,
            nowMs,
            this.numNonNeg('ESCALATION_RESET_SEC', DEFAULT_ESCALATION_RESET_SEC) * 1000,
          );
        if (controlMode === 'MANUAL' || stale || duplicate) {
          // MANUAL: no automatic zone signals, only the operator's commands. A stale or retried ping never
          // delivers (or records) a signal either.
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
            // Entering a MORE severe zone than any in this episode is delivered at once, inside the cooldown.
            escalation,
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
              latitude: eLat,
              longitude: eLng,
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
            latitude: eLat,
            longitude: eLng,
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
        if (manualGps) {
          // The animal's position is the operator's point (written by PUT manual-position): a ping only
          // keeps the pulse (and the outside flag in step with the zone).
          const data: Record<string, unknown> = {};
          if (hr !== null) Object.assign(data, { lastHeartRate: hr, lastHeartRateAt: pingTime });
          if (zone !== 'UNKNOWN' && isOutside !== prevOutside) data.isOutsideGeofence = isOutside;
          if (Object.keys(data).length) await this.prisma.animal.update({ where: { id: animal.id }, data });
        } else if (lowAccuracy) {
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
    if (animal && !evalFix && hr !== null) {
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
    // The first ping after a process restart (no track entry) also checks: the watcher's mark may predate it.
    if (animal && device.farmId && (wasOffline || !st || (lastBeat > 0 && nowMs - lastBeat > offlineThresholdMs))) {
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
    const fresh = evalFix && !stale;
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
      gpsLostMaybeOpen,
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

    if (controlMode === 'MANUAL' && zone !== 'UNKNOWN') {
      warningMessage = `Mode MANUAL: zone ${zone}, automatic signals are off.`;
    }
    if (unknownReason === 'NO_MANUAL_POSITION' && zone === 'UNKNOWN') {
      warningMessage = 'Zone UNKNOWN: mode GPS_MANUAL, no manual position set yet. No signals.';
    }

    if (!device.farmId) warningMessage = 'Device not claimed yet';

    if (suppressedBy) warningMessage += ' Some signals are suppressed by the daily limit.';

    // Deliver at most one queued command per ping. A delivered command stays PENDING and is re-delivered
    // (same id, the firmware ignores a repeated id) until it was delivered COMMAND_MAX_DELIVERIES times or
    // COMMAND_REDELIVER_WINDOW_MS passed since its first delivery, then it is marked EXECUTED: a reply that
    // was lost to a client timeout does not lose the command.
    let command: { id: string; type: 'TEST_SOUND' | 'TEST_SPEAKER' | 'TEST_BUZZER' | 'TEST_VIBRATION' } | undefined;
    for (let i = 0; i < 5 && !command; i++) {
      const pending: any = await this.prisma.deviceCommand.findFirst({
        where: { deviceId: device.deviceId, status: 'PENDING', command: { in: ['TEST_SOUND', 'TEST_SPEAKER', 'TEST_BUZZER', 'TEST_VIBRATION'] } },
        orderBy: { createdAt: 'asc' },
      });
      if (!pending) break;
      const count: number = pending.deliveryCount ?? 0;
      const firstAt: number | null = pending.deliveredAt ? new Date(pending.deliveredAt).getTime() : null;
      if (count >= COMMAND_MAX_DELIVERIES || (count >= 1 && firstAt !== null && nowMs - firstAt > COMMAND_REDELIVER_WINDOW_MS)) {
        // Done: close it without delivering again and look at the next one.
        await this.prisma.deviceCommand.updateMany({
          where: { id: pending.id, status: 'PENDING' },
          data: { status: 'EXECUTED', executedAt: now },
        });
        continue;
      }
      const delivery = count + 1;
      const claimedCmd = await this.prisma.deviceCommand.updateMany({
        where: { id: pending.id, status: 'PENDING', deliveryCount: count },
        data: {
          deliveryCount: delivery,
          deliveredAt: pending.deliveredAt ?? now,
          ...(delivery >= COMMAND_MAX_DELIVERIES && { status: 'EXECUTED', executedAt: now }),
        },
      });
      if (claimedCmd.count === 1) command = { id: pending.id, type: pending.command as any };
      break; // a lost race (a parallel ping took this delivery): none this ping
    }

    try {
      // The pulse of this ping, or the stored one while it is still fresh (<= 120 s); never an old value.
      let streamHr: number | null = hr;
      let streamHrAt: string | null = hr != null ? pingTime.toISOString() : null;
      if (hr == null) {
        const stored = TelemetryService.freshStoredHeartRate(device.animal, nowMs);
        if (stored) {
          streamHr = stored.value;
          streamHrAt = stored.at;
        }
      }
      const pulseThreat = computePulseThreat(device.animal?.species, streamHr);
      // GPS_MANUAL: the streamed position is the operator's point, not the collar's GPS.
      const evLat = manualGps ? manualLat : typeof dto.latitude === 'number' && isFinite(dto.latitude) ? dto.latitude : null;
      const evLng = manualGps ? manualLng : typeof dto.longitude === 'number' && isFinite(dto.longitude) ? dto.longitude : null;
      this.telemetryEvents$.next({
        farmId: device.farmId ?? null,
        deviceId: device.deviceId,
        code: device.code ?? null,
        animalId: device.animal?.id || device.animalId || null,
        animalName: device.animal?.name || null,
        heartRate: streamHr,
        lastHeartRateAt: streamHrAt,
        pulseThreat,
        latitude: evLat,
        longitude: evLng,
        accuracyM: manualGps ? (hasManual ? 0 : null) : dto.accuracy ?? null,
        zone,
        inFence,
        distanceToBorderMeters,
        sound,
        vibrate,
        lastSeenAt: pingTime.toISOString(),
        serverTime: now.toISOString(),
        rssi: dto.signal ?? null,
        controlMode,
        positionSource: manualGps ? 'MANUAL' : 'GPS',
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
      controlMode,
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
