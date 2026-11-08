import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Path prefixes owned by the API. They never fall back to index.html (a missing API route
 * stays a JSON 404). Keep in sync with the controllers (all under `api/v1`) and `GET /health`.
 */
export const RESERVED_PREFIXES = ['/api', '/health'] as const;

export function defaultSiteDistDir(): string {
  return path.resolve(__dirname, '../../../site/dist');
}

export function isReservedPath(p: string): boolean {
  return RESERVED_PREFIXES.some((r) => p === r || p.startsWith(r + '/'));
}

/** True when a GET/HEAD request for `urlPath` should be answered with the SPA's index.html. */
export function shouldServeIndex(method: string, urlPath: string, accepts: (type: string) => unknown): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (isReservedPath(urlPath)) return false;
  // Requests for a missing file (/foo.js, /assets/x.css) must be a real 404, not HTML.
  if (path.extname(urlPath) !== '') return false;
  return Boolean(accepts('html'));
}

const ONE_YEAR = 'public, max-age=31536000, immutable';

/**
 * Serves the built site from `distDir` (default: SITE_DIST_DIR or ../../site/dist).
 * No-op (logged) when the directory or its index.html is missing, so the API still starts.
 */
export function mountSite(app: NestExpressApplication, distDir: string): boolean {
  const logger = new Logger('Site');
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    logger.warn(`site not served: ${indexFile} not found (set SITE_DIST_DIR or build site/)`);
    return false;
  }

  app.useStaticAssets(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      const rel = path.relative(distDir, filePath).split(path.sep);
      if (rel[0] === 'assets') res.setHeader('Cache-Control', ONE_YEAR); // Vite hashes these
      else if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!shouldServeIndex(req.method, req.path, (t) => req.accepts(t))) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile, (err) => err && next(err));
  });

  logger.log(`serving site from ${distDir}`);
  return true;
}
