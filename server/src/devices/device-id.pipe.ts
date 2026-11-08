import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;

/** Validates a public collar id taken from the URL (e.g. "QAM-0005"). */
@Injectable()
export class DeviceIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) {
      throw new BadRequestException('deviceId: 3-40 символов (латиница, цифры, _ и -)');
    }
    return value;
  }
}
