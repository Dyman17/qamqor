import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  /** 8-digit code of the ESP32: the owner "claims" the collar with it. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{8}$/, { message: 'code: ровно 8 цифр' })
  code?: string;

  /** Legacy (pre-code) registration; the service requires `code` or `deviceId`. */
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Идентификатор устройства (Device ID) не может быть пустым' })
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'deviceId: 3-40 символов (латиница, цифры, _ и -)' })
  deviceId?: string; // e.g. "QAM-0005"

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
