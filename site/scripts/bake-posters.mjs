#!/usr/bin/env node
// Bakes the six static scene posters (site/public/posters/scene-N.webp) from the real GLB through the same three.js stage
// the landing uses (transparent background, model centred). Needs the dev server running: npm run dev (port in argv[2]).
//   node scripts/bake-posters.mjs http://localhost:5174
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/posters');
mkdirSync(out, { recursive: true });
// P per scene: the hold pose of each scene (scene 5 exploded, scene 6 assembled).
const SHOTS = [0.0, 0.27, 0.43, 0.59, 0.78, 0.985];

const chrome = await launch(9334);
try {
  const page = await chrome.newPage();
  await page.viewport(1440, 900);
  await page.goto(base + '/', 5000);
  const ok = await page.eval('Boolean(window.__stage)');
  if (!ok) throw new Error('window.__stage is missing (is this the dev server and did the stage load?)');
  for (let i = 0; i < SHOTS.length; i++) {
    const b64 = await page.eval(`(async () => { const b = await window.__stage.snapshotAt(${SHOTS[i]}, 1280, 960); const r = new FileReader(); return await new Promise((res) => { r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }); })()`);
    const buf = Buffer.from(b64, 'base64');
    writeFileSync(resolve(out, `scene-${i + 1}.webp`), buf);
    console.log(`scene-${i + 1}.webp ${(buf.length / 1024).toFixed(1)} KB`);
  }
  if (page.logs.length) console.log(page.logs.join('\n'));
} finally { await chrome.close(); }
