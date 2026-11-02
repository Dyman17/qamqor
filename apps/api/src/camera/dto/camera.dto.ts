import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadCameraSnapshotDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (deviceId) обязателен' })
  deviceId!: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  trigger?: string; // MANUAL_REQUEST, GEOFENCE_BREACH, PERIODIC, MOCK_TEST

  @IsOptional()
  @IsString()
  imageBase64?: string; // If image is sent as base64 string
}

export class RequestPhotoCommandDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (deviceId) обязателен' })
  deviceId!: string;

  @IsOptional()
  @IsString()
  resolution?: string; // e.g. "VGA", "SVGA", "UXGA"
}

