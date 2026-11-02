import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class CameraService {
  private readonly logger = new Logger(CameraService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'snapshots');

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Save snapshot received from ESP32-CAM or Mock
   */
  async saveSnapshot(
    token: string | undefined,
    data: {
      deviceId: string;
      trigger?: string;
      fileBuffer?: Buffer;
      imageBase64?: string;
      originalName?: string;
    },
  ) {
    const masterSecret = this.configService.get<string>(
      'DEVICE_MASTER_SECRET',
      'qamqor_esp32_device_shared_key_2026',
    );

    // 1. Verify device
    const device = await this.prisma.device.findUnique({
      where: { deviceId: data.deviceId },
      include: { animal: true, farm: true },
    });

    if (!device) {
      throw new NotFoundException(`Устройство "${data.deviceId}" не зарегистрировано`);
    }

    const isValid = token === device.secretKey || token === masterSecret;
    if (!isValid) {
      throw new UnauthorizedException('Неверный ключ доступа устройства');
    }

    if (!device.farmId) {
      throw new NotFoundException(`Устройство "${data.deviceId}" не привязано к хозяйству`);
    }

    // 2. Process image buffer
    let buffer: Buffer;
    if (data.fileBuffer) {
      buffer = data.fileBuffer;
    } else if (data.imageBase64) {
      const base64Clean = data.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Clean, 'base64');
    } else {
      // Create a default placeholder SVG/JPEG pattern if nothing sent
      buffer = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#1e293b"/><text x="50%" y="50%" fill="#10b981" font-size="24" text-anchor="middle">ESP32-CAM: ${data.deviceId}</text></svg>`,
      );
    }

    const fileName = `${data.deviceId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
    const filePath = path.join(this.uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);

    const imageUrl = `/api/v1/camera/snapshots/image/${fileName}`;

    // 3. Save database record
    const snapshot = await this.prisma.cameraSnapshot.create({
      data: {
        deviceId: device.deviceId,
        animalId: device.animalId,
        farmId: device.farmId,
        imageUrl,
        trigger: data.trigger || 'MANUAL_REQUEST',
        fileSize: buffer.length,
      },
    });

    // 4. Update animal's photoUrl if animal has no photo
    if (device.animalId && !device.animal?.photoUrl) {
      await this.prisma.animal.update({
        where: { id: device.animalId },
        data: { photoUrl: imageUrl },
      });
    }

    // 5. Mark pending photo command as EXECUTED
    await this.prisma.deviceCommand.updateMany({
      where: {
        deviceId: device.deviceId,
        command: 'CAPTURE_PHOTO',
        status: 'PENDING',
      },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
      },
    });

    this.logger.log(`📸 New snapshot saved for device ${device.deviceId} (Size: ${buffer.length} bytes)`);

    return {
      success: true,
      snapshotId: snapshot.id,
      imageUrl: snapshot.imageUrl,
      capturedAt: snapshot.capturedAt,
      deviceId: device.deviceId,
      animalName: device.animal?.name,
    };
  }

  /**
   * ESP32-CAM queries: Are there any pending commands for me?
   * (e.g. CAPTURE_PHOTO, BUZZER_ON, etc.)
   */
  async pollPendingCommands(token: string | undefined, deviceId: string) {
    const masterSecret = this.configService.get<string>(
      'DEVICE_MASTER_SECRET',
      'qamqor_esp32_device_shared_key_2026',
    );

    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    }

    const isValid = token === device.secretKey || token === masterSecret;
    if (!isValid) {
      throw new UnauthorizedException('Неверный ключ доступа устройства');
    }

    const pendingCommand = await this.prisma.deviceCommand.findFirst({
      where: {
        deviceId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pendingCommand) {
      return {
        hasCommand: false,
        serverTime: new Date().toISOString(),
      };
    }

    return {
      hasCommand: true,
      commandId: pendingCommand.id,
      command: pendingCommand.command,
      payload: pendingCommand.payload,
      createdAt: pendingCommand.createdAt,
    };
  }

  /**
   * Farmer orders ESP32-CAM to take a photo
   */
  async requestPhoto(userId: string, farmId: string, deviceId: string, resolution = 'SVGA') {
    const device = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
      include: { animal: true },
    });

    if (!device) {
      throw new NotFoundException(`Ошейник/камера "${deviceId}" не найдена в этом хозяйстве`);
    }

    const command = await this.prisma.deviceCommand.create({
      data: {
        deviceId,
        command: 'CAPTURE_PHOTO',
        status: 'PENDING',
        payload: { resolution, requestedBy: userId },
      },
    });

    this.logger.log(`User ${userId} requested snapshot for device ${deviceId}`);

    return {
      success: true,
      commandId: command.id,
      command: command.command,
      deviceId,
      animalName: device.animal?.name,
      message: `Команда "Сделать снимок" поставлена в очередь для ${deviceId}. Камера сделает фото при следующем выходе на связь.`,
    };
  }

  /**
   * List gallery of camera snapshots for farm / animal
   */
  async listSnapshots(farmId: string, animalId?: string, limit = 50) {
    const where: any = { farmId };
    if (animalId) {
      where.animalId = animalId;
    }

    return this.prisma.cameraSnapshot.findMany({
      where,
      include: {
        animal: {
          select: { id: true, name: true, tagNumber: true, species: true },
        },
      },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get physical file path
   */
  getImageFilePath(fileName: string): string {
    const safeFileName = path.basename(fileName);
    const filePath = path.join(this.uploadDir, safeFileName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Изображение не найдено');
    }
    return filePath;
  }
}

