import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (Device ID) обязателен' })
  deviceId!: string; // e.g. "QAM-0005"

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  animalId?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  animalId?: string | null;

  @IsOptional()
  @IsString()
  secretKey?: string;
}

