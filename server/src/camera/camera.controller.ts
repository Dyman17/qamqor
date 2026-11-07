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
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image'))
  async uploadSnapshot(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: UploadCameraSnapshotDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    return this.cameraService.saveSnapshot(token, {
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
  async pollCommands(
    @Headers('authorization') authHeader: string | undefined,
    @Query('deviceId') deviceId: string,
  ) {
    if (!deviceId) {
      throw new BadRequestException('Параметр deviceId обязателен');
    }

    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    return this.cameraService.pollPendingCommands(token, deviceId);
  }

  /**
   * 3. Farmer / Web Endpoint: Request immediate photo from ESP32-CAM
   */
  @Post('request-photo')
  @UseGuards(JwtAuthGuard)
  async requestPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId: string | undefined,
    @Body() dto: RequestPhotoCommandDto,
  ) {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }

    return this.cameraService.requestPhoto(user.id, farmId, dto.deviceId, dto.resolution);
  }

  /**
   * 4. Farmer / Web Endpoint: Gallery of snapshots
   */
  @Get('snapshots')
  @UseGuards(JwtAuthGuard)
  async listSnapshots(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-farm-id') headerFarmId: string | undefined,
    @Query('animalId') animalId?: string,
    @Query('limit') limit?: string,
  ) {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }

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

