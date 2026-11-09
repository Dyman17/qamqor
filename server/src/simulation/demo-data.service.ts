import { ConflictException, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { generateDeviceSecret, hashDeviceSecret } from '../devices/device-secret';
import { PenGeometry, rectanglePolygon } from './geometry';
import { mulberry32 } from './scenario';
import { penGeometryOf } from './pen-cache';

export const MAX_DEMO_ANIMALS = 20;
/** Demo pen used only when the farm has no pen at all: 600 x 400 m near Aktau (owner decision). */
export const DEMO_PEN = { name: 'Демо-пастбище', lat: 43.65, lng: 51.157, widthM: 600, heightM: 400 };

const NAMES = [
  'Айгерим', 'Жолбарыс', 'Бота', 'Арлан', 'Алтын', 'Көкжал', 'Сұңқар', 'Ақбота', 'Қарагер', 'Тайлақ',
  'Дулат', 'Шолпан', 'Қызыл', 'Бұлан', 'Алмас', 'Жұлдыз', 'Сәулет', 'Нұрай', 'Дана', 'Бәйтерек',
];

const SPECIES = ['HORSE', 'CAMEL', 'CATTLE', 'SHEEP', 'GOAT'];

/** Creation, reset and removal of demo rows. Demo rows are always labelled (isDemo / isSimulated). */
@Injectable()
export class DemoDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The demo herd always lives in its own demo pen (isDemo = true): a real pen is never reused, so
   * returning to REAL can delete the demo pen without ever unfencing a real animal.
   * The pen shape follows the farm's oldest real pen when it has a valid one (the demo herd then
   * walks the same grass), otherwise the 600 x 400 m Aktau rectangle.
   */
  async ensurePen(farmId: string, db: any = this.prisma) {
    const existing = await db.geofence.findFirst({ where: { farmId, isDemo: true }, orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    const real = await db.geofence.findFirst({ where: { farmId, isDemo: false }, orderBy: { createdAt: 'asc' } });
    return db.geofence.create({
      data: {
        farmId,
        name: DEMO_PEN.name,
        color: '#10B981',
        isDemo: true,
        // A copy of the real polygon (the real pen itself is never touched or shared).
        polygonJson: (real?.polygonJson ??
          rectanglePolygon(DEMO_PEN.lat, DEMO_PEN.lng, DEMO_PEN.widthM, DEMO_PEN.heightM)) as any,
      },
    });
  }

  async counts(farmId: string): Promise<{ animals: number; alerts: number }> {
    const [animals, alerts] = await Promise.all([
      this.prisma.animal.count({ where: { farmId, isDemo: true } }),
      this.prisma.alert.count({ where: { farmId, isDemo: true } }),
    ]);
    return { animals, alerts };
  }

  /** Creates one demo animal with a simulated collar `QAM-DEMO-xxxx`, inside the farm's demo pen. */
  async createAnimal(
    farmId: string,
    opts: { name?: string; species?: string } = {},
    pen?: any,
  ): Promise<{ id: string }> {
    const count = await this.prisma.animal.count({ where: { farmId, isDemo: true } });
    if (count >= MAX_DEMO_ANIMALS) {
      throw new ConflictException(`Не больше ${MAX_DEMO_ANIMALS} демо-животных на ферму`);
    }
    const geofence = pen ?? (await this.ensurePen(farmId));
    const geom = penGeometryOf(geofence);
    const rng = mulberry32(Date.now() ^ count);
    const start = geom ? geom.toGeo(geom.interiorPoint(rng, 25)) : null;
    const species = opts.species && SPECIES.includes(opts.species) ? opts.species : 'CATTLE';
    const now = new Date();

    for (let attempt = 0; attempt < 6; attempt++) {
      // The tag must not collide with ANY animal of the farm (a real animal may be called "D-001" too).
      const tags = await this.prisma.animal.findMany({ where: { farmId }, select: { tagNumber: true } });
      const taken = new Set(tags.map((t) => t.tagNumber));
      const used = [...taken].map((t) => /^D-(\d+)$/.exec(t)?.[1]).filter(Boolean).map(Number);
      let n = (used.length ? Math.max(...used) : 0) + 1;
      while (taken.has(`D-${String(n).padStart(3, '0')}`)) n++;
      const tag = `D-${String(n).padStart(3, '0')}`;
      const name = opts.name?.trim() || NAMES[(n - 1) % NAMES.length];
      const deviceId = `QAM-DEMO-${randomBytes(2).toString('hex').toUpperCase()}`;
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const animal = await tx.animal.create({
            data: {
              farmId,
              name,
              tagNumber: tag,
              species: species as any,
              isDemo: true,
              activeGeofenceId: geofence.id,
              ...(start && {
                lastLatitude: start.latitude,
                lastLongitude: start.longitude,
                lastAccuracy: 5,
                lastSeenAt: now,
              }),
            },
          });
          // The secret is random and never stored or shown: a simulated collar cannot ping over HTTP.
          await tx.device.create({
            data: {
              deviceId,
              secretHash: hashDeviceSecret(generateDeviceSecret()),
              isSimulated: true,
              farmId,
              animalId: animal.id,
              status: 'ONLINE',
              signal: -70,
              lastHeartbeatAt: now,
            },
          });
          return { id: animal.id };
        });
        // Two concurrent calls can both pass the check above: the loser removes itself.
        const total = await this.prisma.animal.count({ where: { farmId, isDemo: true } });
        if (total > MAX_DEMO_ANIMALS) {
          await this.prisma.device.deleteMany({ where: { farmId, isSimulated: true, animalId: created.id } });
          await this.prisma.animal.deleteMany({ where: { id: created.id, isDemo: true } });
          throw new ConflictException(`Не больше ${MAX_DEMO_ANIMALS} демо-животных на ферму`);
        }
        return created;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        // tag clash or device id clash: draw again (both are recomputed on the next pass)
        const target = String(e?.meta?.target ?? '');
        if (attempt === 5) {
          throw new ConflictException(
            target.includes('deviceId') ? 'Не удалось выбрать идентификатор ошейника, повторите' : 'Не удалось выбрать бирку, повторите',
          );
        }
      }
    }
    throw new ConflictException('Не удалось создать демо-животное, повторите');
  }

  /** Brings the demo herd up to `herd` animals (never above the cap, never removes any). */
  async ensureHerd(farmId: string, herd: number): Promise<void> {
    const pen = await this.ensurePen(farmId);
    const existing = await this.prisma.animal.findMany({
      where: { farmId, isDemo: true },
      select: { id: true, activeGeofenceId: true },
    });
    const orphan = existing.filter((a) => !a.activeGeofenceId).map((a) => a.id);
    if (orphan.length) {
      await this.prisma.animal.updateMany({ where: { id: { in: orphan } }, data: { activeGeofenceId: pen.id } });
    }
    const need = Math.min(herd, MAX_DEMO_ANIMALS) - existing.length;
    if (need > 0) await this.createMany(farmId, need, pen, existing.length);
  }

  /** Creates `n` demo animals with collars in two inserts (one transaction): few round trips on a remote DB. */
  private async createMany(farmId: string, n: number, pen: any, have: number): Promise<void> {
    const geom = penGeometryOf(pen);
    const rng = mulberry32(Date.now() ^ have);
    const now = new Date();
    for (let attempt = 0; attempt < 6; attempt++) {
      const tags = await this.prisma.animal.findMany({ where: { farmId }, select: { tagNumber: true } });
      const taken = new Set(tags.map((t) => t.tagNumber));
      const used = [...taken].map((t) => /^D-(\d+)$/.exec(t)?.[1]).filter(Boolean).map(Number);
      let next = (used.length ? Math.max(...used) : 0) + 1;
      const animals: any[] = [];
      const devices: any[] = [];
      for (let i = 0; i < n; i++) {
        while (taken.has(`D-${String(next).padStart(3, '0')}`)) next++;
        const tag = `D-${String(next).padStart(3, '0')}`;
        taken.add(tag);
        const id = randomUUID();
        const start = geom ? geom.toGeo(geom.interiorPoint(rng, 25)) : null;
        animals.push({
          id,
          farmId,
          name: NAMES[(next - 1) % NAMES.length],
          tagNumber: tag,
          species: 'CATTLE',
          isDemo: true,
          activeGeofenceId: pen.id,
          ...(start && { lastLatitude: start.latitude, lastLongitude: start.longitude, lastAccuracy: 5, lastSeenAt: now }),
        });
        devices.push({
          deviceId: `QAM-DEMO-${randomBytes(3).toString('hex').toUpperCase()}`,
          secretHash: hashDeviceSecret(generateDeviceSecret()),
          isSimulated: true,
          farmId,
          animalId: id,
          status: 'ONLINE',
          signal: -70,
          lastHeartbeatAt: now,
        });
      }
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.animal.createMany({ data: animals });
          await tx.device.createMany({ data: devices });
        });
        const total = await this.prisma.animal.count({ where: { farmId, isDemo: true } });
        if (total > MAX_DEMO_ANIMALS) {
          const ids = animals.map((a) => a.id);
          await this.prisma.device.deleteMany({ where: { farmId, isSimulated: true, animalId: { in: ids } } });
          await this.prisma.animal.deleteMany({ where: { id: { in: ids }, isDemo: true } });
          throw new ConflictException(`Не больше ${MAX_DEMO_ANIMALS} демо-животных на ферму`);
        }
        return;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        if (attempt === 5) throw new ConflictException('Не удалось выбрать бирку, повторите');
      }
    }
  }

  /** Removes the newest demo animals beyond `keep`, with their collars, alerts and history. */
  async trimHerd(farmId: string, keep: number): Promise<void> {
    const animals = await this.prisma.animal.findMany({
      where: { farmId, isDemo: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const surplus = animals.slice(keep).map((a) => a.id);
    if (!surplus.length) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.alert.deleteMany({ where: { farmId, isDemo: true, animalId: { in: surplus } } });
      await tx.device.deleteMany({ where: { farmId, isSimulated: true, animalId: { in: surplus } } });
      await tx.animal.deleteMany({ where: { farmId, isDemo: true, id: { in: surplus } } });
    });
  }

  /**
   * REAL: deletes every demo row of the farm and nothing else. Real animals, collars, pens, alerts
   * and telemetry are untouched (all deletes are filtered by isDemo / isSimulated).
   */
  async purge(farmId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.alert.deleteMany({ where: { farmId, isDemo: true } });
        await tx.signalEvent.deleteMany({ where: { farmId, animal: { isDemo: true } } });
        await tx.telemetry.deleteMany({ where: { animal: { farmId, isDemo: true } } });
        // Telemetry of the simulated collars goes with them (cascade).
        await tx.device.deleteMany({
          where: {
            farmId,
            isSimulated: true,
            OR: [{ animal: { isDemo: true } }, { animalId: null, deviceId: { startsWith: 'QAM-DEMO-' } }],
          },
        });
        await tx.animal.deleteMany({ where: { farmId, isDemo: true } });
        // A demo pen that a real animal was moved into is adopted (no longer demo), never deleted:
        // returning to REAL must not unfence a real animal.
        const adopted = await tx.animal.findMany({
          where: { farmId, activeGeofenceId: { not: null } },
          select: { activeGeofenceId: true },
        });
        const keep = [...new Set(adopted.map((a) => a.activeGeofenceId))];
        if (keep.length) await tx.geofence.updateMany({ where: { farmId, isDemo: true, id: { in: keep } }, data: { isDemo: false } });
        await tx.geofence.deleteMany({ where: { farmId, isDemo: true } });
      },
      { timeout: 20_000 },
    );
  }

  /** Reset: drops demo alerts, telemetry and signal events and puts the herd back inside the pen. */
  async reset(farmId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.alert.deleteMany({ where: { farmId, isDemo: true } });
        await tx.signalEvent.deleteMany({ where: { farmId, animal: { isDemo: true } } });
        await tx.telemetry.deleteMany({ where: { animal: { farmId, isDemo: true } } });
        const animals = await tx.animal.findMany({
          where: { farmId, isDemo: true },
          include: { activeGeofence: true, device: { select: { id: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const rng = mulberry32(now.getTime());
        for (const a of animals) {
          const geom: PenGeometry | null = penGeometryOf(a.activeGeofence);
          const p = geom ? geom.toGeo(geom.interiorPoint(rng, 25)) : null;
          await tx.animal.update({
            where: { id: a.id },
            data: {
              isOutsideGeofence: false,
              ...(p && { lastLatitude: p.latitude, lastLongitude: p.longitude, lastAccuracy: 5, lastSeenAt: now }),
            },
          });
          if (a.device) {
            await tx.device.update({ where: { id: a.device.id }, data: { status: 'ONLINE', lastHeartbeatAt: now } });
          }
        }
      },
      { timeout: 20_000 },
    );
  }
}
