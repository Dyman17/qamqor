import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFarmDto {
  @IsString()
  @IsNotEmpty({ message: 'Название хозяйства обязательно' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateFarmDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
