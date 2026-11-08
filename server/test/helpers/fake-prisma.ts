import { randomUUID } from 'crypto';

/**
 * Minimal in-memory stand-in for PrismaService, enough for the telemetry pipeline, alerts, the
 * offline watcher and the demo modes. No database is touched. `calls` counts every model operation.
 */
type Row = Record<string, any>;

const REL: Record<string, Record<string, { table: string; local?: string; foreign?: string; many?: boolean }>> = {
  device: { farm: { table: 'farm', local: 'farmId' }, animal: { table: 'animal', local: 'animalId' } },
  animal: {
    device: { table: 'device', foreign: 'animalId' },
    activeGeofence: { table: 'geofence', local: 'activeGeofenceId' },
    farm: { table: 'farm', local: 'farmId' },
    alerts: { table: 'alert', foreign: 'animalId', many: true },
  },
  telemetry: { animal: { table: 'animal', local: 'animalId' } },
  signalEvent: { animal: { table: 'animal', local: 'animalId' } },
  alert: { animal: { table: 'animal', local: 'animalId' } },
  farmMember: { farm: { table: 'farm', local: 'farmId' } },
  geofence: { animals: { table: 'animal', foreign: 'activeGeofenceId', many: true } },
};

const DEFAULTS: Record<string, () => Row> = {
  farm: () => ({ workerCanEditBoundaries: false, timezone: 'Asia/Aqtau', dataMode: 'REAL', simSpeed: 1, simHerd: 8, simUntil: null, simLeaseUntil: null, description: null }),
  animal: () => ({ isDemo: false, isOutsideGeofence: false, gender: 'UNKNOWN', activeGeofenceId: null, lastLatitude: null, lastLongitude: null, lastAccuracy: null, lastSeenAt: null }),
  device: () => ({ isSimulated: false, status: 'INACTIVE', signal: null, lastHeartbeatAt: null, animalId: null, farmId: null }),
  geofence: () => ({ isDemo: false, isActive: true, color: '#10B981' }),
  alert: () => ({ isDemo: false, isRead: false, status: 'ACTIVE', severity: 'WARNING', resolvedAt: null, dedupeKey: null, animalId: null, deviceId: null, latitude: null, longitude: null }),
  telemetry: () => ({ isOutsideGeofence: false }),
  signalEvent: () => ({}),
  deviceCommand: () => ({ status: 'PENDING' }),
  signalLimit: () => ({}),
  farmMember: () => ({ role: 'WORKER' }),
};

const ms = (v: any) => (v instanceof Date ? v.getTime() : v);

function opsMatch(v: any, cond: any): boolean {
  const val = ms(v);
  for (const [op, raw] of Object.entries(cond)) {
    const c: any = ms(raw);
    switch (op) {
      case 'equals': if (val !== c) return false; break;
      case 'not': if (c === null ? val == null : val === c) return false; break;
      case 'in': if (!(raw as any[]).map(ms).includes(val)) return false; break;
      case 'notIn': if ((raw as any[]).map(ms).includes(val)) return false; break;
      case 'lt': if (!(val != null && val < c)) return false; break;
      case 'lte': if (!(val != null && val <= c)) return false; break;
      case 'gt': if (!(val != null && val > c)) return false; break;
      case 'gte': if (!(val != null && val >= c)) return false; break;
      case 'startsWith': if (!(typeof val === 'string' && val.startsWith(c))) return false; break;
      case 'contains': if (!(typeof val === 'string' && val.toLowerCase().includes(String(c).toLowerCase()))) return false; break;
      case 'mode': break;
      default: throw new Error(`fake-prisma: unsupported operator ${op}`);
    }
  }
  return true;
}

const OP_KEYS = new Set(['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'startsWith', 'contains', 'mode']);

export class FakePrisma {
  tables: Record<string, Row[]> = {};
  calls = 0;
  [k: string]: any;

  constructor() {
    for (const t of ['user', 'farm', 'farmMember', 'animal', 'device', 'geofence', 'telemetry', 'alert', 'signalEvent', 'signalLimit', 'deviceCommand']) {
      this.tables[t] = [];
      this[t] = this.model(t);
    }
  }

  async $transaction(arg: any, _opts?: any) {
    return typeof arg === 'function' ? arg(this) : Promise.all(arg);
  }
  async $queryRaw() {
    return [{ locked: true }];
  }

  private related(table: string, row: Row, rel: string): Row | Row[] | null {
    const r = REL[table]?.[rel];
    if (!r) throw new Error(`fake-prisma: no relation ${table}.${rel}`);
    if (r.local) return this.tables[r.table].find((x) => x.id === row[r.local!]) ?? null;
    const rows = this.tables[r.table].filter((x) => x[r.foreign!] === row.id);
    return r.many ? rows : rows[0] ?? null;
  }

  private matches(table: string, row: Row, where: Row = {}): boolean {
    for (const [k, cond] of Object.entries(where)) {
      if (k === 'OR') { if (!(cond as Row[]).some((w) => this.matches(table, row, w))) return false; continue; }
      if (k === 'AND') { if (!(Array.isArray(cond) ? cond : [cond]).every((w: Row) => this.matches(table, row, w))) return false; continue; }
      if (k === 'NOT') { if (this.matches(table, row, cond as Row)) return false; continue; }
      if (cond === undefined) continue;
      if (REL[table]?.[k]) {
        const rel = this.related(table, row, k);
        if (Array.isArray(rel) || rel === null) { if (rel === null) return false; if (!rel.some((x) => this.matches(REL[table][k].table, x, cond as Row))) return false; continue; }
        if (!this.matches(REL[table][k].table, rel, cond as Row)) return false;
        continue;
      }
      const isOps = cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).every((x) => OP_KEYS.has(x));
      if (isOps) { if (!opsMatch(row[k], cond)) return false; continue; }
      if (cond === null) { if (row[k] != null) return false; continue; }
      if (ms(row[k]) !== ms(cond)) return false;
    }
    return true;
  }

  private flat(where: Row = {}): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(where)) {
      if (/^\w+_\w+$/.test(k) && v && typeof v === 'object' && !(v instanceof Date) && !OP_KEYS.has(Object.keys(v)[0]) && !REL_KEYS.has(k)) Object.assign(out, v);
      else out[k] = v;
    }
    return out;
  }

  private withInclude(table: string, row: Row, include?: Row): Row {
    if (!include) return { ...row };
    const out = { ...row };
    for (const [rel, spec] of Object.entries(include)) {
      if (!spec) continue;
      let val: any = this.related(table, row, rel);
      const r = REL[table][rel];
      const opts: Row = spec === true ? {} : (spec as Row);
      if (Array.isArray(val)) {
        if (opts.where) val = val.filter((x) => this.matches(r.table, x, opts.where));
        if (opts.take) val = val.slice(0, opts.take);
        if (opts.include) val = val.map((x: Row) => this.withInclude(r.table, x, opts.include));
      } else if (val && opts.include) {
        val = this.withInclude(r.table, val, opts.include);
      } else if (val) val = { ...val };
      out[rel] = val;
    }
    return out;
  }

  private sorted(rows: Row[], orderBy: any): Row[] {
    const list = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).filter((o: Row) => {
      const [k, d] = Object.entries(o)[0];
      return typeof d === 'string';
    });
    if (!list.length) return rows;
    return [...rows].sort((a, b) => {
      for (const o of list) {
        const [k, d] = Object.entries(o)[0] as [string, string];
        const x = ms(a[k]);
        const y = ms(b[k]);
        if (x === y) continue;
        return (x > y ? 1 : -1) * (d === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }

  private cascadeDelete(table: string, gone: Row[]) {
    const ids = new Set(gone.map((r) => r.id));
    if (table === 'animal') {
      this.tables.signalEvent = this.tables.signalEvent.filter((x) => !ids.has(x.animalId));
      for (const t of ['telemetry', 'alert']) for (const x of this.tables[t]) if (ids.has(x.animalId)) x.animalId = null;
      for (const x of this.tables.device) if (ids.has(x.animalId)) x.animalId = null;
    }
    if (table === 'device') {
      const dev = new Set(gone.map((r) => r.deviceId));
      this.tables.telemetry = this.tables.telemetry.filter((x) => !dev.has(x.deviceId));
      this.tables.deviceCommand = this.tables.deviceCommand.filter((x) => !dev.has(x.deviceId));
      for (const x of this.tables.alert) if (dev.has(x.deviceId)) x.deviceId = null;
    }
    if (table === 'geofence') {
      for (const x of this.tables.animal) if (ids.has(x.activeGeofenceId)) x.activeGeofenceId = null;
    }
  }

  private model(table: string) {
    const self = this;
    const rows = () => self.tables[table];
    const find = (where?: Row) => rows().filter((r) => self.matches(table, r, self.flat(where)));
    const op = <T>(fn: () => T): Promise<T> => { self.calls++; return Promise.resolve().then(fn); };
    const unique = (data: Row, existing?: Row) => {
      if (table === 'device' && rows().some((r) => r !== existing && r.deviceId === data.deviceId)) throw Object.assign(new Error('P2002'), { code: 'P2002', meta: { target: ['deviceId'] } });
      if (table === 'animal' && rows().some((r) => r !== existing && r.farmId === data.farmId && r.tagNumber === data.tagNumber)) throw Object.assign(new Error('P2002'), { code: 'P2002', meta: { target: ['farmId', 'tagNumber'] } });
    };
    return {
      findMany: ({ where, include, orderBy, take, cursor, skip }: Row = {}) => op(() => {
        let r = self.sorted(find(where), orderBy);
        if (take) r = r.slice(0, take);
        return r.map((x) => self.withInclude(table, x, include));
      }),
      findFirst: ({ where, include, orderBy }: Row = {}) => op(() => {
        const r = self.sorted(find(where), orderBy)[0];
        return r ? self.withInclude(table, r, include) : null;
      }),
      findUnique: ({ where, include }: Row) => op(() => {
        const r = find(where)[0];
        return r ? self.withInclude(table, r, include) : null;
      }),
      findUniqueOrThrow: ({ where, include }: Row) => op(() => {
        const r = find(where)[0];
        if (!r) throw new Error(`${table} not found`);
        return self.withInclude(table, r, include);
      }),
      count: ({ where }: Row = {}) => op(() => find(where).length),
      create: ({ data }: Row) => op(() => {
        const row: Row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[table]?.() ?? {}), ...data };
        for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
        unique(row);
        rows().push(row);
        return { ...row };
      }),
      createMany: ({ data }: Row) => op(() => {
        for (const d of data) rows().push({ id: randomUUID(), createdAt: new Date(), ...(DEFAULTS[table]?.() ?? {}), ...d });
        return { count: data.length };
      }),
      update: ({ where, data, include }: Row) => op(() => {
        const r = find(where)[0];
        if (!r) throw Object.assign(new Error(`${table} not found`), { code: 'P2025' });
        const next = { ...r, ...data, updatedAt: new Date() };
        unique(next, r);
        Object.assign(r, data, { updatedAt: new Date() });
        return self.withInclude(table, r, include);
      }),
      updateMany: ({ where, data }: Row) => op(() => {
        const hit = find(where);
        for (const r of hit) Object.assign(r, data, { updatedAt: new Date() });
        return { count: hit.length };
      }),
      deleteMany: ({ where }: Row = {}) => op(() => {
        const hit = find(where);
        const set = new Set(hit);
        self.tables[table] = rows().filter((r) => !set.has(r));
        self.cascadeDelete(table, hit);
        return { count: hit.length };
      }),
      delete: ({ where }: Row) => op(() => {
        const hit = find(where);
        const set = new Set(hit);
        self.tables[table] = rows().filter((r) => !set.has(r));
        self.cascadeDelete(table, hit);
        return hit[0];
      }),
    };
  }
}

const REL_KEYS = new Set<string>();
