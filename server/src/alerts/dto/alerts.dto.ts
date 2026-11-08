import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AlertStatus, AlertType } from '@qamqor/shared';
import { PageQueryDto } from '../../common/pagination';

export class ListAlertsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @IsOptional()
  @IsUUID()
  animalId?: string;
}

export class UpdateAlertStatusDto {
  @IsEnum(AlertStatus, { message: 'Некорректный статус оповещения' })
  status!: AlertStatus;
}
