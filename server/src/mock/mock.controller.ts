import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { MockService } from './mock.service';
import { InjectTelemetryDto, SimulateActionDto, InjectPhotoDto } from './dto/mock.dto';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/mock')
@UseGuards(JwtAuthGuard, FarmAccessGuard)
export class MockController {
  constructor(private readonly mockService: MockService) {}

  /**
   * 1. Ввести координаты вручную с сайта (вместо физического ESP)
   */
  @Post('inject-telemetry')
  async injectTelemetry(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InjectTelemetryDto,
    @FarmId() farmId: string,
  ) {
    return this.mockService.injectManualTelemetry(user.id, farmId, dto);
  }

  /**
   * 2. Кнопка «Смоделировать побег животного»
   */
  @Post('simulate-breach')
  async simulateBreach(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SimulateActionDto,
    @FarmId() farmId: string,
  ) {
    return this.mockService.simulateBreach(user.id, farmId, dto.animalId);
  }

  /**
   * 3. Кнопка «Вернуть животное в загон»
   */
  @Post('simulate-return')
  async simulateReturn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SimulateActionDto,
    @FarmId() farmId: string,
  ) {
    return this.mockService.simulateReturn(user.id, farmId, dto.animalId);
  }

  /**
   * 4. Кнопка «Сделать тестовый снимок камеры с ошейника»
   */
  @Post('inject-photo')
  async injectPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InjectPhotoDto,
    @FarmId() farmId: string,
  ) {
    return this.mockService.injectPhoto(user.id, farmId, dto);
  }
}

