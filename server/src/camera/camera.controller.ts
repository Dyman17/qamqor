import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CameraService } from './camera.service';
import { UploadCameraSnapshotDto, RequestPhotoCommandDto, ListSnapshotsQueryDto } from './dto/camera.dto';
import { MAX_IMAGE_BYTES } from './image-type';
import { DeviceAuthGuard } from '../devices/device-auth.guard';
import { CurrentDevice } from '../devices/current-device.decorator';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

/** Not mounted (see CameraService). */
@Controller('api/v1/camera')
export class CameraController {
  constructor(private readonly cameraService: CameraService) {}

  /** Camera collar: upload a snapshot (multipart field `image`, JPEG/PNG, up to 1 MB). */
  @Post('upload')
  @UseGuards(DeviceAuthGuard)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8 } }))
  async uploadSnapshot(
    @CurrentDevice() device: any,
    @Body() dto: UploadCameraSnapshotDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.cameraService.saveSnapshot(device, {
      deviceId: dto.deviceId,
      trigger: dto.trigger,
      fileBuffer: file?.buffer,
      imageBase64: dto.imageBase64,
    });
  }

  /** Camera collar: poll pending commands. */
  @Get('commands')
  @UseGuards(DeviceAuthGuard)
  async pollCommands(@CurrentDevice() device: any, @Query('deviceId') deviceId: string) {
    if (!deviceId) throw new BadRequestException('Параметр deviceId обязателен');
    return this.cameraService.pollPendingCommands(device, deviceId);
  }

  @Post('request-photo')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
  async requestPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Body() dto: RequestPhotoCommandDto,
  ) {
    return this.cameraService.requestPhoto(user.id, farmId, dto.deviceId, dto.resolution);
  }

  @Get('snapshots')
  @UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
  async listSnapshots(@FarmId() farmId: string, @Query() q: ListSnapshotsQueryDto) {
    return this.cameraService.listSnapshots(farmId, q.animalId, q.limit ?? 50);
  }

  /** Image of a snapshot: JWT + membership of the snapshot's farm; the type comes from the stored file. */
  @Get('snapshots/:id/image')
  @UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
  async serveImage(@FarmId() farmId: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { filePath, mime } = await this.cameraService.getSnapshotFile(farmId, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(filePath);
  }
}
