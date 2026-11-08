import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { isReservedPath, mountSite, shouldServeIndex } from '../src/config/site';
import { buildCsp } from '../src/config/csp';
import { securityHeaders } from '../src/config/security-headers';

const html = () => true;
const json = (t: string) => t !== 'html';

describe('shouldServeIndex', () => {
  it('serves index for SPA routes that accept html', () => {
    for (const p of ['/', '/farms-list', '/map/herd/3', '/login']) expect(shouldServeIndex('GET', p, html)).toBe(true);
  });
  it('never serves index for API / health paths', () => {
    for (const p of ['/api', '/api/v1/animals', '/api/info', '/api/v1/nope', '/health', '/health/x']) {
      expect(shouldServeIndex('GET', p, html)).toBe(false);
      expect(isReservedPath(p)).toBe(true);
    }
  });
  it('does not treat lookalike prefixes as reserved', () => {
    expect(isReservedPath('/apiary')).toBe(false);
    expect(isReservedPath('/healthy')).toBe(false);
  });
  it('rejects non-GET, non-html and missing-file requests', () => {
    expect(shouldServeIndex('POST', '/login', html)).toBe(false);
    expect(shouldServeIndex('GET', '/login', json)).toBe(false);
    expect(shouldServeIndex('GET', '/assets/missing.js', html)).toBe(false);
  });
});

describe('CSP', () => {
  it('is sent with security headers and allows blob workers + data images', () => {
    const headers: Record<string, string> = {};
    securityHeaders(false)({} as any, { setHeader: (k: string, v: string) => (headers[k] = v), removeHeader: jest.fn() } as any, jest.fn());
    const csp = headers['Content-Security-Policy'];
    expect(csp).toBe(buildCsp());
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('worker-src');
    expect(csp).toMatch(/img-src [^;]*data:/);
    expect(csp).toContain("object-src 'none'");
  });
});

describe('mountSite (real Nest app)', () => {
  @Module({})
  class Empty {}

  const start = async (dir: string) => {
    const app = await NestFactory.create<NestExpressApplication>(Empty, { logger: false });
    const mounted = mountSite(app, dir);
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    return { app, base, mounted };
  };

  it('starts without serving when the dist dir is missing', async () => {
    const { app, mounted, base } = await start(path.join(os.tmpdir(), 'qamqor-no-such-dist'));
    expect(mounted).toBe(false);
    expect((await fetch(`${base}/`, { headers: { accept: 'text/html' } })).status).toBe(404);
    await app.close();
  });

  it('serves index, hashed assets and keeps API paths out of the fallback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qamqor-site-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>spa</title>');
    fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    const { app, base, mounted } = await start(dir);
    try {
      expect(mounted).toBe(true);
      const idx = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
      expect(idx.status).toBe(200);
      expect(idx.headers.get('cache-control')).toBe('no-cache');
      expect(await idx.text()).toContain('spa');

      const deep = await fetch(`${base}/some/client/route`, { headers: { accept: 'text/html' } });
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain('spa');

      const asset = await fetch(`${base}/assets/app-abc123.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('cache-control')).toContain('immutable');

      expect((await fetch(`${base}/assets/missing.js`, { headers: { accept: 'text/html' } })).status).toBe(404);
      const api = await fetch(`${base}/api/v1/animals`, { headers: { accept: 'text/html' } });
      expect(api.status).toBe(404);
      expect(await api.text()).not.toContain('spa');
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
