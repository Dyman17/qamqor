import {
  ValidateIf,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DeviceTelemetryRequestDto } from '@qamqor/contracts';

const hasCoords = (o: any) =>
  (o.latitude !== undefined && o.latitude !== null) ||
  (o.longitude !== undefined && o.longitude !== null) ||
  (o.accuracy !== undefined && o.accuracy !== null);

export class DeviceTelemetryDto implements DeviceTelemetryRequestDto {
  /** 8-digit device code; identifies the collar (the guard also accepts the X-Device-Code header). */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{8}$/, { message: 'code: ровно 8 цифр' })
  code?: string;

  /** Legacy; overwritten by the controller from the authenticated device. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'deviceId: 3-40 символов (латиница, цифры, _ и -)' })
  deviceId?: string;

  /** ISO 8601 with a time zone designator; the acceptance window is checked by the service. */
  @ValidateIf((o) => o.timestamp !== undefined || (o.latitude !== undefined && o.latitude !== null) || (o.longitude !== undefined && o.longitude !== null))
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(Z|[+-]\d{2}:?\d{2})$/, { message: 'timestamp: нужен часовой пояс (Z или +hh:mm)' })
  @MaxLength(40)
  timestamp?: string;

  /** Optional as a pair: a pulse-only ping (no GPS fix) omits latitude, longitude and accuracy. */
  @ValidateIf(hasCoords)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ValidateIf(hasCoords)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ValidateIf(hasCoords)
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;

  /** RSSI, dBm. */
  @IsOptional()
  @IsNumber()
  @Min(-130)
  @Max(0)
  signal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  speedKmh?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99)
  hdop?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(64)
  satellites?: number;

  /** Pulse, BPM; null when the sensor has no contact. */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  heartRate?: number | null;
}
