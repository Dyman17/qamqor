import { registerDecorator, ValidationOptions } from 'class-validator';

export function isValidTimeZone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** IANA time zone name, e.g. "Asia/Aqtau". */
export function IsTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: { message: 'Некорректный часовой пояс (IANA)', ...options },
      validator: { validate: (v: unknown) => isValidTimeZone(v) },
    });
}

/** bcrypt only uses the first 72 BYTES, so the limit is on bytes, not characters. */
export function IsPasswordBytesMax(max = 72, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isPasswordBytesMax',
      target: object.constructor,
      propertyName,
      options: { message: `Пароль: не более ${max} байт`, ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= max },
    });
}
