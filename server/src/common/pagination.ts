import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const PAGE_DEFAULT_LIMIT = 50;
export const PAGE_MAX_LIMIT = 100;

/** `?limit` (1-100, default 50) and `?cursor` (id of the last item of the previous page). */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit: целое число' })
  @Min(1)
  @Max(PAGE_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Slices an ordered list after `cursor` (an item id). An unknown cursor starts from the beginning. */
export function pageOf<T extends { id: string }>(all: T[], q: { limit?: number; cursor?: string }): Page<T> {
  const limit = q.limit ?? PAGE_DEFAULT_LIMIT;
  let start = 0;
  if (q.cursor) {
    const i = all.findIndex((x) => x.id === q.cursor);
    start = i >= 0 ? i + 1 : 0;
  }
  const items = all.slice(start, start + limit);
  const hasMore = start + limit < all.length;
  return { items, nextCursor: hasMore && items.length ? items[items.length - 1].id : null };
}
