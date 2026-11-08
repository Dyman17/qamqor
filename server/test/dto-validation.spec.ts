import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterDto, LoginUserDto, PasswordResetRequestDto, AcceptInvitationDto } from '../src/auth/dto/auth.dto';
import { CreateFarmDto, UpdateFarmDto } from '../src/farms/dto/farm.dto';
import { CreateInvitationDto } from '../src/farms/dto/invitation.dto';
import { CreateAnimalInputDto, UpdateAnimalInputDto, AssignCollarDto } from '../src/animals/dto/animal.dto';
import { CreateGeofenceInputDto } from '../src/geofences/dto/geofence.dto';
import { RegisterDeviceDto, UpdateDeviceDto, TestSignalDto } from '../src/devices/dto/device.dto';
import {
  SetDataModeDto, StartSimulationDto, PatchSimulationDto, SimulateAnimalDto, SimulateTelemetryDto, SimulateEventDto,
} from '../src/simulation/dto/simulation.dto';
import { UpdateAlertStatusDto, ListAlertsQueryDto } from '../src/alerts/dto/alerts.dto';
import { DeviceTelemetryDto } from '../src/telemetry/dto/device-telemetry.dto';
import { DeviceIdPipe } from '../src/devices/device-id.pipe';
import { AppController } from '../src/app.controller';
import { AuthController } from '../src/auth/auth.controller';
import { FarmsController } from '../src/farms/farms.controller';
import { AnimalsController } from '../src/animals/animals.controller';
import { GeofenceController } from '../src/geofences/geofence.controller';
import { DevicesController } from '../src/devices/devices.controller';
import { AlertsController } from '../src/alerts/alerts.controller';
import { AnalyticsController } from '../src/analytics/analytics.controller';
import { TelemetryController } from '../src/telemetry/telemetry.controller';
import { SimulationController } from '../src/simulation/simulation.controller';
import { routesOf } from './helpers/routes';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const check = (metatype: any, value: any, type: 'body' | 'query' = 'body') => pipe.transform(value, { type, metatype });
const UUID = '3f2b8c1e-9d4a-4c1b-8f6e-2a7d5b9c0e11';
const long = (n: number) => 'x'.repeat(n);
const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

describe('DTOs reject too long strings, bad ids and unknown fields (400)', () => {
  const cases: Array<[string, any, any]> = [
    ['register: email too long', RegisterDto, { email: long(250) + '@b.kz', password: 'password1', fullName: 'A' }],
    ['register: fullName too long', RegisterDto, { email: 'a@b.kz', password: 'password1', fullName: long(121) }],
    ['register: unknown field', RegisterDto, { email: 'a@b.kz', password: 'password1', fullName: 'A', role: 'OWNER' }],
    ['login: password 129 chars', LoginUserDto, { email: 'a@b.kz', password: long(129) }],
    ['reset request: bad lang', PasswordResetRequestDto, { email: 'a@b.kz', lang: 'de' }],
    ['accept invitation: short token', AcceptInvitationDto, { token: 'abc' }],
    ['farm create: name too long', CreateFarmDto, { name: long(121) }],
    ['farm update: bad timezone', UpdateFarmDto, { timezone: 'Mars/Base' }],
    ['farm update: unknown field', UpdateFarmDto, { ownerId: UUID }],
    ['invitation: not an email', CreateInvitationDto, { email: 'nope' }],
    ['animal: name too long', CreateAnimalInputDto, { name: long(121), tag: 't', species: 'CATTLE' }],
    ['animal: farmId is not accepted', CreateAnimalInputDto, { name: 'n', tag: 't', species: 'CATTLE', farmId: UUID }],
    ['animal: bad penId', CreateAnimalInputDto, { name: 'n', tag: 't', species: 'CATTLE', penId: 'x' }],
    ['animal: bad collarId', CreateAnimalInputDto, { name: 'n', tag: 't', species: 'CATTLE', collarId: 'a b' }],
    ['animal: bad birthDate', CreateAnimalInputDto, { name: 'n', tag: 't', species: 'CATTLE', birthDate: 'yesterday' }],
    ['animal: javascript: photo url', CreateAnimalInputDto, { name: 'n', tag: 't', species: 'CATTLE', photoUrl: 'javascript:alert(1)' }],
    ['animal update: empty tag', UpdateAnimalInputDto, { tag: '' }],
    ['assign collar: bad id', AssignCollarDto, { deviceId: '../etc' }],
    ['geofence: bad color', CreateGeofenceInputDto, { name: 'g', polygon, color: 'red' }],
    ['geofence: animalIds not uuid', CreateGeofenceInputDto, { name: 'g', polygon, animalIds: ['x'] }],
    ['geofence: name too long', CreateGeofenceInputDto, { name: long(121), polygon }],
    ['device: id too long', RegisterDeviceDto, { deviceId: long(41) }],
    ['device: id with spaces', RegisterDeviceDto, { deviceId: 'QAM 0001' }],
    ['device: secret supplied by the client', RegisterDeviceDto, { deviceId: 'QAM-0001', secretKey: 'abc' }],
    ['device update: animalId not uuid', UpdateDeviceDto, { animalId: 'x' }],
    ['test signal: IMPULSE', TestSignalDto, { signal: 'IMPULSE' }],
    ['device claim: code with 7 digits', RegisterDeviceDto, { code: '1234567' }],
    ['device claim: code with letters', RegisterDeviceDto, { code: '1234abcd' }],
    ['device claim: code with 9 digits', RegisterDeviceDto, { code: '123456789' }],
    ['telemetry: code with letters', DeviceTelemetryDto, { code: 'abcdefgh', timestamp: new Date().toISOString(), latitude: 1, longitude: 1, accuracy: 1 }],
    ['data-mode: unknown mode', SetDataModeDto, { mode: 'DEMO' }],
    ['data-mode: missing mode', SetDataModeDto, {}],
    ['sim start: speed 3', StartSimulationDto, { speed: 3 }],
    ['sim start: herd 0', StartSimulationDto, { herd: 0 }],
    ['sim start: herd 21', StartSimulationDto, { herd: 21 }],
    ['sim start: hours 9', StartSimulationDto, { hours: 9 }],
    ['sim start: hours 0', StartSimulationDto, { hours: 0 }],
    ['sim start: unknown field', StartSimulationDto, { speed: 1, extra: true }],
    ['sim patch: speed 100', PatchSimulationDto, { speed: 100 }],
    ['simulate animal: bad species', SimulateAnimalDto, { species: 'DRAGON' }],
    ['simulate animal: name too long', SimulateAnimalDto, { name: long(61) }],
    ['simulate telemetry: animalId not uuid', SimulateTelemetryDto, { animalId: 'x', lat: 1, lng: 1 }],
    ['simulate telemetry: lat out of range', SimulateTelemetryDto, { animalId: UUID, lat: 91, lng: 1 }],
    ['simulate telemetry: lng out of range', SimulateTelemetryDto, { animalId: UUID, lat: 1, lng: 181 }],
    ['simulate telemetry: negative accuracy', SimulateTelemetryDto, { animalId: UUID, lat: 1, lng: 1, accuracyM: -1 }],
    ['simulate event: unknown event', SimulateEventDto, { animalId: UUID, event: 'EXPLODE' }],
    ['simulate event: animalId not uuid', SimulateEventDto, { animalId: 'x', event: 'BREACH' }],
    ['alert status: bad value', UpdateAlertStatusDto, { status: 'DELETED' }],
    ['telemetry: deviceId with a path', DeviceTelemetryDto, { deviceId: '../x', timestamp: new Date().toISOString(), latitude: 1, longitude: 1, accuracy: 1 }],
    ['telemetry: signal out of range', DeviceTelemetryDto, { deviceId: 'QAM-0001', timestamp: new Date().toISOString(), latitude: 1, longitude: 1, accuracy: 1, signal: 50 }],
  ];
  it.each(cases)('%s', async (_n, dto, body) => {
    await expect(check(dto, body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('alerts query: bad uuid and bad status', async () => {
    await expect(check(ListAlertsQueryDto, { animalId: 'x' }, 'query')).rejects.toBeInstanceOf(BadRequestException);
    await expect(check(ListAlertsQueryDto, { status: 'NOPE' }, 'query')).rejects.toBeInstanceOf(BadRequestException);
    await expect(check(ListAlertsQueryDto, { status: 'ACTIVE', limit: '20' }, 'query')).resolves.toMatchObject({ limit: 20 });
  });

  it('valid minimal bodies still pass', async () => {
    await expect(check(RegisterDto, { email: 'a@b.kz', password: 'password1', fullName: 'A' })).resolves.toBeDefined();
    await expect(check(RegisterDeviceDto, { deviceId: 'QAM-0001' })).resolves.toBeDefined();
    await expect(check(TestSignalDto, { signal: 'SOUND' })).resolves.toBeDefined();
    await expect(check(CreateGeofenceInputDto, { name: 'g', polygon, color: '#10B981' })).resolves.toBeDefined();
    await expect(check(RegisterDeviceDto, { code: '12345678' })).resolves.toBeDefined();
    await expect(check(DeviceTelemetryDto, { code: '12345678', timestamp: new Date().toISOString(), latitude: 1, longitude: 1, accuracy: 1 })).resolves.toBeDefined();
    await expect(check(SetDataModeDto, { mode: 'AUTO' })).resolves.toBeDefined();
    await expect(check(StartSimulationDto, {})).resolves.toBeDefined();
    await expect(check(StartSimulationDto, { speed: 10, herd: 20, hours: 8 })).resolves.toBeDefined();
    await expect(check(SimulateTelemetryDto, { animalId: UUID, lat: 43.65, lng: 51.157 })).resolves.toBeDefined();
    await expect(check(SimulateEventDto, { animalId: UUID, event: 'COLLAR_OFFLINE' })).resolves.toBeDefined();
  });

  it('DeviceIdPipe guards the collar id in the URL', () => {
    const p = new DeviceIdPipe();
    expect(p.transform('QAM-0001')).toBe('QAM-0001');
    expect(() => p.transform('a/b')).toThrow(BadRequestException);
    expect(() => p.transform('ab')).toThrow(BadRequestException);
  });
});

describe('README documents only routes that exist', () => {
  const norm = (r: string) => r.replace(/:\w+/g, ':p');
  const actual = new Set(
    [AppController, AuthController, FarmsController, AnimalsController, GeofenceController, DevicesController, AlertsController, AnalyticsController, TelemetryController, SimulationController]
      .flatMap(routesOf)
      .map(norm),
  );
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const documented = Array.from(readme.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/\S*?)`/g)).map((m) => norm(`${m[1]} ${m[2]}`));

  it('every route named in the README is real (no PUT /geofences, /alerts/:id/resolve, /animals/:id/steer, /farms/:id/members POST)', () => {
    expect(documented.length).toBeGreaterThan(30);
    expect(documented.filter((r) => !actual.has(r))).toEqual([]);
  });

  it('every real route is documented', () => {
    const set = new Set(documented);
    expect([...actual].filter((r) => !set.has(r))).toEqual([]);
  });
});
