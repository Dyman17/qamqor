#!/usr/bin/env node
// QA harness: opens URLs in headless Chrome at several viewports, reports horizontal overflow and console errors,
// and saves screenshots. Landing scenes are reached by scrolling the pinned stage to a progress value P.
//
//   node scripts/qa-shots.mjs <baseUrl> <outDir> [--route /] [--sizes 320x640,375x812,...] [--scenes 0,0.27,...] [--lang ru] [--reduce] [--tag name]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const args = process.argv.slice(2);
const base = args[0];
const out = args[1];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);
if (!base || !out) { console.error('usage: qa-shots.mjs <baseUrl> <outDir> [options]'); process.exit(2); }

const route = opt('route', '/');
const sizes = opt('sizes', '1440x900,1280x720,768x1024,375x812,320x640').split(',').map((s) => s.split('x').map(Number));
const scenes = opt('scenes', '').split(',').filter(Boolean).map(Number);
const lang = opt('lang', 'ru');
const reduce = flag('reduce');
const tag = opt('tag', 'shot');
const scrollSel = opt('scroll', '');
mkdirSync(out, { recursive: true });

const chrome = await launch(Number(opt('port', '9333')));
const report = [];
try {
  for (const [w, h] of sizes) {
    const page = await chrome.newPage();
    await page.viewport(w, h, { mobile: w < 768, reducedMotion: reduce });
    await page.goto(base + '/about-blank-never'); // warm origin for localStorage
    await page.eval(`localStorage.setItem('qamqor.lang', '${lang}')`);
    await page.goto(base + route, 3500);
    const m = await page.eval(`({ iw: innerWidth, sw: document.documentElement.scrollWidth, layout: document.querySelector('.landing')?.dataset.layout ?? null, live: document.getElementById('stage-fig')?.dataset.live ?? null, motion: document.documentElement.dataset.motion })`);
    report.push({ size: `${w}x${h}`, ...m, overflow: m.sw > m.iw, errors: [...page.logs] });
    const name = (s) => join(out, `${tag}-${w}x${h}-${s}.png`);
    if (scenes.length) {
      for (const P of scenes) {
        await page.eval(`(async () => { document.documentElement.style.scrollBehavior = 'auto'; const s = document.getElementById('stage'); const top = s.getBoundingClientRect().top + scrollY; window.scrollTo(0, top + ${P} * (s.offsetHeight - innerHeight)); await new Promise(r => setTimeout(r, 2200)); })()`);
        writeFileSync(name(`p${String(P).replace('.', '')}`), await page.shot());
      }
    } else {
      if (scrollSel) await page.eval(`document.querySelector(${JSON.stringify(scrollSel)})?.scrollIntoView({ behavior: 'instant' }); new Promise(r => setTimeout(r, 800))`);
      writeFileSync(name('top'), await page.shot());
    }
    const after = await page.eval(`({ sw: document.documentElement.scrollWidth, iw: innerWidth })`);
    report[report.length - 1].overflowAfterScroll = after.sw > after.iw;
    report[report.length - 1].errors = [...page.logs];
    page.close();
  }
} finally { await chrome.close(); }
console.log(JSON.stringify(report, null, 2));
