import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { MAX_IMAGE_BYTES, decodeBase64Image, detectImageType } from './image-type';

/**
 * NOTE: the camera module is NOT mounted in AppModule (no camera hardware yet; owner decision
 * 2026-11-08). The code is kept hardened so that mounting it later is safe: JPEG/PNG by
 * signature, 1 MB cap, random file names outside the web root, authenticated download.
 */
@Injectable()
export class CameraService {
  private readonly logger = new Logger(CameraService.name);
  private readonly uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'snapshots');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /** Save a snapshot received from an authenticated camera collar. */
  async saveSnapshot(
    device: any,
    data: { deviceId?: string; trigger?: string; fileBuffer?: Buffer; imageBase64?: string },
  ) {
    // `device` is already authenticated (DeviceAuthGuard).
    if (!device || (data.deviceId && data.deviceId !== device.deviceId)) {
      throw new UnauthorizedException('Invalid device credentials');
    }
    if (!device.farmId) {
      throw new NotFoundException(`Устройство "${device.deviceId}" не привязано к хозяйству`);
    }

    const buffer = data.fileBuffer ?? decodeBase64Image(data.imageBase64);
    if (!buffer) throw new BadRequestException('Изображение не передано или повреждено');
    if (buffer.length > MAX_IMAGE_BYTES) throw new BadRequestException('Изображение больше 1 МБ');
    const type = detectImageType(buffer);
    if (!type) throw new BadRequestException('Допустимы только JPEG и PNG');

    // The file name is a random id; nothing from the request reaches the path.
    const fileName = `${randomUUID()}.${type.ext}`;
    fs.writeFileSync(path.join(this.uploadDir, fileName), buffer);

    const snapshot = await this.prisma.cameraSnapshot.create({
      data: {
        deviceId: device.deviceId,
        animalId: device.animalId,
        farmId: device.farmId,
        imageUrl: fileName, // stored file name; never served by name, only through the snapshot id
        trigger: data.trigger || 'MANUAL_REQUEST',
        fileSize: buffer.length,
      },
    });

    await this.prisma.deviceCommand.updateMany({
      where: { deviceId: device.deviceId, command: 'CAPTURE_PHOTO', status: 'PENDING' },
      data: { status: 'EXECUTED', executedAt: new Date() },
    });

    this.logger.log(`Snapshot ${snapshot.id} saved for device ${device.deviceId} (${buffer.length} bytes)`);
    return { success: true, snapshotId: snapshot.id };
  }

  /** The camera polls for pending commands (CAPTURE_PHOTO). */
  async pollPendingCommands(device: any, deviceId: string) {
    if (!device || device.deviceId !== deviceId) {
      throw new UnauthorizedException('Invalid device credentials');
    }
    const pending = await this.prisma.deviceCommand.findFirst({
      where: { deviceId, status: 'PENDING', command: 'CAPTURE_PHOTO' },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return { hasCommand: false };
    return { hasCommand: true, commandId: pending.id, command: pending.command, payload: pending.payload };
  }

  /** Farmer asks the camera for a photo. */
  async requestPhoto(userId: string, farmId: string, deviceId: string, resolution = 'SVGA') {
    const device = await this.prisma.device.findFirst({ where: { deviceId, farmId } });
    if (!device) throw new NotFoundException(`Ошейник/камера "${deviceId}" не найдена в этом хозяйстве`);
    const command = await this.prisma.deviceCommand.create({
      data: {
        deviceId,
        command: 'CAPTURE_PHOTO',
        status: 'PENDING',
        payload: { resolution, requestedBy: userId },
      },
    });
    return { commandId: command.id };
  }

  async listSnapshots(farmId: string, animalId?: string, limit = 50) {
    const rows = await this.prisma.cameraSnapshot.findMany({
      where: { farmId, ...(animalId && { animalId }) },
      select: { id: true, deviceId: true, animalId: true, trigger: true, fileSize: true, capturedAt: true },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({ ...r, imageUrl: `/api/v1/camera/snapshots/${r.id}/image` }));
  }

  /** File of a snapshot of this farm (404 for anything else). */
  async getSnapshotFile(farmId: string, snapshotId: string): Promise<{ filePath: string; mime: string }> {
    const snap = await this.prisma.cameraSnapshot.findFirst({ where: { id: snapshotId, farmId } });
    if (!snap) throw new NotFoundException('Изображение не найдено');
    const fileName = path.basename(snap.imageUrl);
    const filePath = path.join(this.uploadDir, fileName);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Изображение не найдено');
    return { filePath, mime: fileName.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
}
