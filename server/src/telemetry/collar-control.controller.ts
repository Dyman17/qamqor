import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { CollarControlService } from './collar-control.service';
import { DeviceIdPipe } from '../devices/device-id.pipe';
import { ManualPositionDto, SetControlModeDto } from '../devices/dto/device.dto';
import { FarmAccessGuard } from '../farms/farm-access.guard';
import { PermissionsGuard } from '../farms/permissions.guard';
import { FarmId } from '../farms/farm-context.decorator';
import { FarmRoles } from '../farms/roles.decorator';
import { forbiddenRole } from '../common/errors';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';

const MIN = 60_000;

/**
 * Control modes of a real collar (AUTO / GPS_MANUAL / MANUAL). Switching to MANUAL or GPS_MANUAL and
 * moving the manual point are OWNER only (they switch off the automatic protection of an animal); any
 * member may restore AUTO. Lives in the telemetry module (it needs the zone logic and the live stream).
 */
@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard, FarmAccessGuard, PermissionsGuard)
export class CollarControlController {
  constructor(private readonly control: CollarControlService) {}

  @Patch(':id/control-mode')
  @UseGuards(RateLimitGuard)
  @RateLimit('collar-control-mode', { limit: 30, windowMs: MIN, perUser: true, perIp: false })
  setControlMode(
    @Param('id', DeviceIdPipe) deviceId: string,
    @Body() dto: SetControlModeDto,
    @FarmId() farmId: string,
    @Req() req: any,
  ) {
    if (dto.mode !== 'AUTO' && req?.memberRole !== 'OWNER') {
      throw forbiddenRole('Ручные режимы ошейника доступны только владельцу хозяйства');
    }
    return this.control.setControlMode(farmId, deviceId, dto.mode);
  }

  /** Called while the operator drags the animal on the map, hence the generous limit. */
  @Put(':id/manual-position')
  @FarmRoles('OWNER')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit('collar-manual-position', { limit: 120, windowMs: MIN, perUser: true, perIp: false })
  setManualPosition(
    @Param('id', DeviceIdPipe) deviceId: string,
    @Body() dto: ManualPositionDto,
    @FarmId() farmId: string,
  ) {
    return this.control.setManualPosition(farmId, deviceId, dto.latitude, dto.longitude);
  }
}
