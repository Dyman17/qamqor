import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Headers,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CameraService } from './camera.service';
import { UploadCameraSnapshotDto, RequestPhotoCommandDto } from './dto/camera.dto';
import { DeviceAuthGuard } from '../devices/device-auth.guard';
import { CurrentDevice } from '../devices/current-device.decorator';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/camera')
export class CameraController {
  constructor(private readonly cameraService: CameraService) {}

  /**
   * 1. ESP32-CAM Endpoint: Upload snapshot photo
   * Supports both multipart/form-data (field 'image') and JSON base64
   */
  @Post('upload')
  @UseGuards(DeviceAuthGuard)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image'))
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
      originalName: file?.originalname,
    });
  }

  /**
   * 2. ESP32-CAM Endpoint: Poll pending commands
   * ESP32 queries: does the farmer want me to take a picture now?
   */
  @Get('commands')
  @UseGuards(DeviceAuthGuard)
  async pollCommands(
    @CurrentDevice() device: any,
    @Query('deviceId') deviceId: string,
  ) {
    if (!deviceId) {
      throw new BadRequestException('Параметр deviceId обязателен');
    }

    return this.cameraService.pollPendingCommands(device, deviceId);
  }

  /**
   * 3. Farmer / Web Endpoint: Request immediate photo from ESP32-CAM
   */
  @Post('request-photo')
  @UseGuards(JwtAuthGuard, FarmAccessGuard)
  async requestPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Body() dto: RequestPhotoCommandDto,
  ) {
    return this.cameraService.requestPhoto(user.id, farmId, dto.deviceId, dto.resolution);
  }

  /**
   * 4. Farmer / Web Endpoint: Gallery of snapshots
   */
  @Get('snapshots')
  @UseGuards(JwtAuthGuard, FarmAccessGuard)
  async listSnapshots(
    @CurrentUser() user: AuthenticatedUser,
    @FarmId() farmId: string,
    @Query('animalId') animalId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.cameraService.listSnapshots(
      farmId,
      animalId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /**
   * 5. Public Endpoint: Serve snapshot image file
   */
  @Get('snapshots/image/:fileName')
  async serveImage(@Param('fileName') fileName: string, @Res() res: Response) {
    const filePath = this.cameraService.getImageFilePath(fileName);
    return res.sendFile(filePath);
  }
}

