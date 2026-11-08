import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (Device ID) обязателен' })
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'deviceId: 3-40 символов (латиница, цифры, _ и -)' })
  deviceId!: string; // e.g. "QAM-0005"

  @IsOptional()
  @IsUUID()
  animalId?: string;
}

export class UpdateDeviceDto {
  /** UUID of the animal to assign, or null to unassign. */
  @IsOptional()
  @IsUUID()
  animalId?: string | null;
}

/** IMPULSE is deliberately not accepted. */
export class TestSignalDto {
  @IsIn(['SOUND', 'VIBRATION'])
  signal!: 'SOUND' | 'VIBRATION';
}
