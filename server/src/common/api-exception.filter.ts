import { requestDeviceCode } from '../devices/device-auth.guard';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_FARM'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'MAIL_NOT_CONFIGURED'
  | 'INTERNAL';

const BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN_ROLE',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION',
  429: 'RATE_LIMITED',
};

/** Builds the contract error body `{ statusCode, code, message }` for any exception. */
export function toErrorBody(exception: unknown): { statusCode: number; body: Record<string, unknown> } {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const res = exception.getResponse();
    let message = exception.message;
    let code: string | undefined;
    const extra: Record<string, unknown> = {};
    if (typeof res === 'string') {
      message = res;
    } else if (res && typeof res === 'object') {
      const r = res as Record<string, any>;
      code = r.code;
      if (Array.isArray(r.message)) message = r.message.join('; ');
      else if (typeof r.message === 'string') message = r.message;
      if (typeof r.retryAfterSec === 'number') extra.retryAfterSec = r.retryAfterSec;
    }
    return {
      statusCode,
      body: { statusCode, code: code ?? BY_STATUS[statusCode] ?? 'INTERNAL', message, ...extra },
    };
  }

  // Safety net for database errors that escaped a service.
  const e = exception as any;
  if (e && typeof e === 'object' && typeof e.code === 'string' && /^P\d{4}$/.test(e.code)) {
    if (e.code === 'P2002') return { statusCode: 409, body: { statusCode: 409, code: 'CONFLICT', message: 'Запись уже существует' } };
    if (e.code === 'P2025') return { statusCode: 404, body: { statusCode: 404, code: 'NOT_FOUND', message: 'Запись не найдена' } };
  }
  return { statusCode: 500, body: { statusCode: 500, code: 'INTERNAL', message: 'Internal server error' } };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const { statusCode, body } = toErrorBody(exception);
    if (statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();
    if (typeof req?.originalUrl === 'string' && req.originalUrl.split('?')[0].endsWith('/api/v1/device/telemetry')) {
      // Device protocol: `code` is the request's 8-digit device code (the firmware matches it);
      // the error kind moves to `error`.
      res.status(statusCode).json({ ...body, error: body.code, code: requestDeviceCode(req) });
      return;
    }
    res.status(statusCode).json(body);
  }
}
