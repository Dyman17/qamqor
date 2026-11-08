import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, Module, NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { CameraController } from '../src/camera/camera.controller';
import { CameraModule } from '../src/camera/camera.module';
import { CameraService } from '../src/camera/camera.service';
import { MAX_IMAGE_BYTES, decodeBase64Image, detectImageType } from '../src/camera/image-type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { DeviceSecretAuthGuard } from '../src/devices/device-secret-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { loadAppConfig } from '../src/config/config';
import { hashDeviceSecret } from '../src/devices/device-secret';
import { routesOf } from './helpers/routes';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qamqor-cam-'));
  process.env.UPLOAD_DIR = dir;
});
afterAll(() => {
  delete process.env.UPLOAD_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('camera module is not mounted', () => {
  it('AppModule does not import CameraModule and exposes no /camera route', () => {
    const imports: any[] = Reflect.getMetadata('imports', AppModule);
    expect(imports).not.toContain(CameraModule);
  });
});

describe('image signature detection', () => {
  it('accepts JPEG and PNG by magic bytes only', () => {
    expect(detectImageType(JPEG)).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(detectImageType(PNG)).toEqual({ ext: 'png', mime: 'image/png' });
  });
  it('rejects SVG / HTML / empty / tiny buffers even if named .jpg', () => {
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(HTML)).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(undefined)).toBeNull();
  });
  it('base64: valid accepted, data-URI prefix stripped, oversize and garbage rejected', () => {
    expect(decodeBase64Image(JPEG.toString('base64'))?.equals(JPEG)).toBe(true);
    expect(decodeBase64Image('data:image/png;base64,' + PNG.toString('base64'))?.equals(PNG)).toBe(true);
    expect(decodeBase64Image('!!!not base64!!!')).toBeNull();
    expect(decodeBase64Image(Buffer.alloc(MAX_IMAGE_BYTES + 10).toString('base64'))).toBeNull();
    expect(decodeBase64Image('')).toBeNull();
  });
});

describe('CameraService', () => {
  function svc() {
    const prisma: any = {
      cameraSnapshot: {
        create: jest.fn(async ({ data }: any) => ({ id: 'snap1', ...data })),
        findFirst: jest.fn(async ({ where }: any) => (where.farmId === 'F' && where.id === 'snap1' ? { id: 'snap1', imageUrl: lastFile } : null)),
      },
      deviceCommand: { updateMany: jest.fn() },
      animal: { update: jest.fn() },
    };
    return { prisma, service: new CameraService(prisma) };
  }
  let lastFile = '';
  const device: any = { deviceId: 'QAM-1', farmId: 'F', animalId: 'a1', animal: { photoUrl: null } };

  it('stores a JPEG under a random UUID name, outside any user-controlled path', async () => {
    const { prisma, service } = svc();
    const res = await service.saveSnapshot(device, { deviceId: 'QAM-1', fileBuffer: JPEG });
    expect(res).toEqual({ success: true, snapshotId: 'snap1' });
    const stored = prisma.cameraSnapshot.create.mock.calls[0][0].data.imageUrl as string;
    expect(stored).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(fs.readFileSync(path.join(dir, stored)).equals(JPEG)).toBe(true);
    expect(prisma.animal.update).not.toHaveBeenCalled(); // photoUrl is never filled in automatically
    lastFile = stored;
  });

  it('stores PNG with a .png extension', async () => {
    const { prisma, service } = svc();
    await service.saveSnapshot(device, { fileBuffer: PNG });
    expect(prisma.cameraSnapshot.create.mock.calls[0][0].data.imageUrl).toMatch(/\.png$/);
  });

  it.each([
    ['SVG', SVG],
    ['HTML', HTML],
    ['2 MB image', Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)])],
  ])('%s -> 400 and nothing written', async (_n, buf) => {
    const { prisma, service } = svc();
    const before = fs.readdirSync(dir).length;
    await expect(service.saveSnapshot(device, { fileBuffer: buf })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cameraSnapshot.create).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir).length).toBe(before);
  });

  it('no file and no base64 -> 400 (the SVG placeholder is gone)', async () => {
    const { service } = svc();
    await expect(service.saveSnapshot(device, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the image is served only for a snapshot of the same farm (404 otherwise)', async () => {
    const { service } = svc();
    await service.saveSnapshot(device, { fileBuffer: JPEG }).then(() => undefined);
    const own = await service.getSnapshotFile('F', 'snap1');
    expect(own.mime).toBe('image/jpeg');
    await expect(service.getSnapshotFile('OTHER', 'snap1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getSnapshotFile('F', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CameraController routes', () => {
  it('the public by-file-name route is gone; the image route is by snapshot id and JWT-protected', () => {
    expect(routesOf(CameraController).sort()).toEqual(
      [
        'POST /api/v1/camera/upload',
        'GET /api/v1/camera/commands',
        'POST /api/v1/camera/request-photo',
        'GET /api/v1/camera/snapshots',
        'GET /api/v1/camera/snapshots/:id/image',
      ].sort(),
    );
    const guards = Reflect.getMetadata('__guards__', CameraController.prototype.serveImage);
    expect(guards).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata('__guards__', CameraController.prototype.uploadSnapshot)).toContain(DeviceSecretAuthGuard);
  });
});

describe('upload over HTTP (module mounted only inside this test)', () => {
  const SECRET = 'c'.repeat(64);
  const device = { id: 'd1', deviceId: 'QAM-1', farmId: 'F', animalId: null, secretHash: hashDeviceSecret(SECRET) };
  const prisma = {
    device: { findUnique: jest.fn(async ({ where }: any) => (where.secretHash === device.secretHash ? device : null)) },
    cameraSnapshot: { create: jest.fn(async ({ data }: any) => ({ id: 'snap2', ...data })) },
    deviceCommand: { updateMany: jest.fn() },
  };

  @Module({
    controllers: [CameraController],
    providers: [{ provide: PrismaService, useValue: prisma }, CameraService, DeviceSecretAuthGuard],
  })
  class CamTestModule {}

  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(CamTestModule, { bodyParser: false, logger: false });
    configureApp(app, loadAppConfig({ NODE_ENV: 'test' }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });

  const upload = (buf: Buffer, token: string | null = SECRET, name = 'x.jpg') => {
    const fd = new FormData();
    fd.append('deviceId', 'QAM-1');
    fd.append('image', new Blob([new Uint8Array(buf)]), name);
    return fetch(`${base}/api/v1/camera/upload`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
  };

  it('2 MB file -> 413', async () => {
    const r = await upload(Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]));
    expect(r.status).toBe(413);
    expect(((await r.json()) as any).code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('SVG / HTML disguised as .jpg -> 400', async () => {
    expect((await upload(SVG)).status).toBe(400);
    expect((await upload(HTML, SECRET, 'photo.jpg')).status).toBe(400);
  });
  it('JPEG accepted; no credentials -> 401', async () => {
    const ok = await upload(JPEG);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).snapshotId).toBe('snap2');
    expect((await upload(JPEG, null)).status).toBe(401);
  });
  it('the old public path /camera/snapshots/image/<name> is 404', async () => {
    const r = await fetch(`${base}/api/v1/camera/snapshots/image/x.jpg`);
    expect(r.status).toBe(404);
  });
});
