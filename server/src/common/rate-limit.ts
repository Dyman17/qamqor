import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** Sliding-window counter kept in memory (single server instance). */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Registers one hit; returns whether it is within `limit` per `windowMs`. */
  consume(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
    const t = this.now();
    if (++this.calls % 1000 === 0) this.prune(t, windowMs);
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000)) };
    }
    arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > this.maxKeys) this.evictOldest();
    return { allowed: true, retryAfterSec: 0 };
  }

  reset(): void {
    this.hits.clear();
  }

  size(): number {
    return this.hits.size;
  }

  private prune(t: number, windowMs: number) {
    for (const [k, v] of this.hits) {
      if (!v.length || t - v[v.length - 1] >= windowMs) this.hits.delete(k);
    }
  }

  private evictOldest() {
    let n = Math.ceil(this.maxKeys * 0.1);
    for (const k of this.hits.keys()) {
      this.hits.delete(k);
      if (--n <= 0) break;
    }
  }
}

export interface RateRule {
  /** Max requests per window. */
  limit: number;
  windowMs: number;
  /** Body field mixed into the key (lower-cased), e.g. "email". Omit for a per-IP rule. */
  keyField?: string;
}

export const RATE_LIMIT_KEY = 'qamqor:rateLimit';

/** `@RateLimit('login', {limit: 10, windowMs: 60000, keyField: 'email'}, ...)` */
export const RateLimit = (name: string, ...rules: RateRule[]) => SetMetadata(RATE_LIMIT_KEY, { name, rules });

@Injectable()
export class RateLimiterService {
  readonly limiter = new SlidingWindowLimiter();
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly service: RateLimiterService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.get<{ name: string; rules: RateRule[] } | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!meta) return true;
    const req = context.switchToHttp().getRequest();
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
    for (const [i, rule] of meta.rules.entries()) {
      let key = `${meta.name}:${i}:${ip}`;
      if (rule.keyField) {
        const v = req.body?.[rule.keyField];
        key += `:${typeof v === 'string' ? v.toLowerCase().trim().slice(0, 256) : ''}`;
      }
      const r = this.service.limiter.consume(key, rule.limit, rule.windowMs);
      if (!r.allowed) {
        throw new HttpException(
          { statusCode: 429, code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже', retryAfterSec: r.retryAfterSec },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
