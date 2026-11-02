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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('api/v1/mock')
@UseGuards(JwtAuthGuard)
export class MockController {
  constructor(private readonly mockService: MockService) {}

  private resolveFarmId(user: AuthenticatedUser, headerFarmId?: string): string {
    const farmId = headerFarmId || user.farmId;
    if (!farmId) {
      throw new BadRequestException('ID хозяйства не указан');
    }
    return farmId;
  }

  /**
   * 1. Ввести координаты вручную с сайта (вместо физического ESP)
   */
  @Post('inject-telemetry')
  async injectTelemetry(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InjectTelemetryDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.mockService.injectManualTelemetry(user.id, farmId, dto);
  }

  /**
   * 2. Кнопка «Смоделировать побег животного»
   */
  @Post('simulate-breach')
  async simulateBreach(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SimulateActionDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.mockService.simulateBreach(user.id, farmId, dto.animalId);
  }

  /**
   * 3. Кнопка «Вернуть животное в загон»
   */
  @Post('simulate-return')
  async simulateReturn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SimulateActionDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.mockService.simulateReturn(user.id, farmId, dto.animalId);
  }

  /**
   * 4. Кнопка «Сделать тестовый снимок камеры с ошейника»
   */
  @Post('inject-photo')
  async injectPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InjectPhotoDto,
    @Headers('x-farm-id') headerFarmId?: string,
  ) {
    const farmId = this.resolveFarmId(user, headerFarmId);
    return this.mockService.injectPhoto(user.id, farmId, dto);
  }
}

