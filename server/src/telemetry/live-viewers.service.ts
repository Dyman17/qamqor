import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Max concurrent SSE streams one user may hold open. */
export const MAX_STREAMS_PER_USER = 5;

export function tooManyStreams(): HttpException {
  return new HttpException(
    { statusCode: 429, code: 'RATE_LIMITED', message: 'Слишком много открытых потоков, закройте лишние вкладки', retryAfterSec: 10 },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Tracks who watches a farm live (open SSE streams) so collars can be told to ping often only while
 * somebody looks. A farm stays "live" for a linger period after its last viewer left (page reloads,
 * short network drops). Also counts open streams per user (resource cap).
 *
 * SINGLE INSTANCE: all state is in process memory. With several server instances each one would only
 * know its own viewers; move this to a shared store (e.g. Redis) before scaling out.
 */
@Injectable()
export class LiveViewersService {
  /** Replaceable clock (tests). */
  now: () => number = Date.now;

  private readonly viewers = new Map<string, number>();
  private readonly lastLeft = new Map<string, number>();
  private readonly perUser = new Map<string, number>();

  /** Registers a viewer of the farm; the returned function (idempotent) removes it. */
  join(farmId: string): () => void {
    this.viewers.set(farmId, (this.viewers.get(farmId) ?? 0) + 1);
    this.lastLeft.delete(farmId);
    this.pruneLeft();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (this.viewers.get(farmId) ?? 1) - 1;
      if (n <= 0) {
        this.viewers.delete(farmId);
        this.lastLeft.set(farmId, this.now());
      } else {
        this.viewers.set(farmId, n);
      }
    };
  }

  viewerCount(farmId: string): number {
    return this.viewers.get(farmId) ?? 0;
  }

  /** True while a viewer is connected or the last one left less than `lingerSec` ago. */
  isLive(farmId: string, lingerSec: number): boolean {
    if ((this.viewers.get(farmId) ?? 0) > 0) return true;
    const left = this.lastLeft.get(farmId);
    if (left === undefined) return false;
    if (this.now() - left < lingerSec * 1000) return true;
    this.lastLeft.delete(farmId);
    return false;
  }

  userStreams(userId: string): number {
    return this.perUser.get(userId) ?? 0;
  }

  /** Takes a stream slot for the user, or returns null when `max` are already open. */
  acquireUser(userId: string, max: number = MAX_STREAMS_PER_USER): (() => void) | null {
    const n = this.perUser.get(userId) ?? 0;
    if (n >= max) return null;
    this.perUser.set(userId, n + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const c = (this.perUser.get(userId) ?? 1) - 1;
      if (c <= 0) this.perUser.delete(userId);
      else this.perUser.set(userId, c);
    };
  }

  /** Forgets farms that left more than an hour ago (bounded memory). */
  private pruneLeft() {
    if (this.lastLeft.size < 100) return;
    const t = this.now();
    for (const [k, v] of this.lastLeft) if (t - v > 3600_000) this.lastLeft.delete(k);
  }
}
