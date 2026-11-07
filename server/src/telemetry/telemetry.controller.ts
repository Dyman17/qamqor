import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';

@Controller('api/v1/device')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async receiveTelemetry(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    return this.telemetryService.processDeviceTelemetry(token, dto);
  }

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  setTriggerState(
    @Body() body: {
      deviceId?: string;
      sound?: boolean;
      vibrate?: boolean;
      shock?: boolean;
      reset?: boolean;
      zone?: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE';
      distanceToBorderMeters?: number;
      toneFrequencyHz?: number;
    },
  ) {
    const deviceId = body.deviceId || 'QAM-0001';
    if (body.reset) {
      this.telemetryService.clearManualOverride(deviceId);
      return { success: true, deviceId, message: 'Все триггеры сброшены' };
    }

    let zone = body.zone;
    let sound = body.sound;
    let vibrate = body.vibrate;
    let shock = body.shock;

    if (zone) {
      if (sound === undefined) sound = (zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED');
      if (vibrate === undefined) vibrate = (zone === 'ORANGE' || zone === 'RED');
      if (shock === undefined) shock = (zone === 'RED');
    } else {
      sound = Boolean(sound);
      vibrate = Boolean(vibrate);
      shock = Boolean(shock);
      zone = shock ? 'RED' : vibrate ? 'ORANGE' : sound ? 'YELLOW' : 'GREEN';
    }

    const isOutside = zone === 'RED' || zone === 'ESCAPE' || shock;
    const distanceToBorderMeters =
      body.distanceToBorderMeters ??
      (zone === 'RED' ? 25 : zone === 'ESCAPE' ? 120 : zone === 'ORANGE' ? 3 : zone === 'YELLOW' ? 12 : 50);
    const toneFrequencyHz =
      body.toneFrequencyHz ??
      (zone === 'RED' ? 2400 : zone === 'ORANGE' ? 2000 : zone === 'YELLOW' ? 1200 : 0);

    this.telemetryService.setManualOverride(
      deviceId,
      {
        latitude: isOutside ? 43.6000 : 43.6501,
        longitude: isOutside ? 51.1000 : 51.1572,
        isOutside,
        sound,
        vibrate,
        shock,
        zone,
        distanceToBorderMeters,
        toneFrequencyHz,
        active: true,
      },
      60 * 60 * 1000,
    );

    return {
      success: true,
      deviceId,
      sound,
      vibrate,
      shock,
      zone,
      distanceToBorderMeters,
      toneFrequencyHz,
      message: `Триггеры обновлены: зона=${zone}, звук=${sound}, вибро=${vibrate}, шокер=${shock}`,
    };
  }

  @Post('buzzer')
  @HttpCode(HttpStatus.OK)
  setBuzzerState(
    @Body() body: { deviceId?: string; buzzer: boolean },
  ) {
    const deviceId = body.deviceId || 'QAM-0001';
    const isBuzzerOn = Boolean(body.buzzer);
    this.telemetryService.setManualOverride(
      deviceId,
      {
        latitude: isBuzzerOn ? 43.6000 : 43.6501,
        longitude: isBuzzerOn ? 51.1000 : 51.1572,
        isOutside: isBuzzerOn,
        sound: isBuzzerOn,
        vibrate: isBuzzerOn,
        shock: isBuzzerOn,
        zone: isBuzzerOn ? 'RED' : 'GREEN',
        distanceToBorderMeters: isBuzzerOn ? 25 : 50,
        toneFrequencyHz: isBuzzerOn ? 2400 : 0,
        active: true,
      },
      60 * 60 * 1000,
    );

    return {
      success: true,
      deviceId,
      buzzer: isBuzzerOn,
      message: isBuzzerOn ? 'Buzzer turned ON' : 'Buzzer turned OFF',
    };
  }

  @Get('buzzer')
  getBuzzerDefault() {
    return this.getBuzzerState('QAM-0001');
  }

  @Get('buzzer/:deviceId')
  getBuzzerState(@Param('deviceId') paramDeviceId: string) {
    const deviceId = paramDeviceId || 'QAM-0001';
    const override = this.telemetryService.getManualOverride(deviceId);
    return {
      deviceId,
      buzzer: override?.active ? override.isOutside : false,
    };
  }

  @Get('status')
  getStatusDefault() {
    return this.telemetryService.getDeviceLiveStatus('QAM-0001');
  }

  @Get('status/:deviceId')
  getStatus(@Param('deviceId') paramDeviceId: string) {
    const deviceId = paramDeviceId || 'QAM-0001';
    return this.telemetryService.getDeviceLiveStatus(deviceId);
  }
}

