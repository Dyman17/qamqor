import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsTimeZone } from '../../common/validators';

export class CreateFarmDto {
  @IsString()
  @IsNotEmpty({ message: 'Название хозяйства обязательно' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class UpdateFarmDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  workerCanEditBoundaries?: boolean;
}
