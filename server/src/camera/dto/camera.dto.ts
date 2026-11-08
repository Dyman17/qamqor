import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const DEVICE_ID = /^[A-Za-z0-9_-]{3,40}$/;

export class UploadCameraSnapshotDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (deviceId) обязателен' })
  @Matches(DEVICE_ID)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  timestamp?: string;

  @IsOptional()
  @IsIn(['MANUAL_REQUEST', 'GEOFENCE_BREACH', 'PERIODIC'])
  trigger?: string;

  /** Alternative to the multipart file; capped at ~1.4 MB of base64. */
  @IsOptional()
  @IsString()
  @MaxLength(1_400_000)
  imageBase64?: string;
}

export class RequestPhotoCommandDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (deviceId) обязателен' })
  @Matches(DEVICE_ID)
  deviceId!: string;

  @IsOptional()
  @IsIn(['VGA', 'SVGA', 'UXGA'])
  resolution?: string;
}

export class ListSnapshotsQueryDto {
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
