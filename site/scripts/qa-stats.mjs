#!/usr/bin/env node
// QA: the "official sources" stats block on the landing never clips text (every element scrollWidth <= clientWidth) and the page never overflows.
//   node scripts/qa-stats.mjs http://127.0.0.1:4173 <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const base = process.argv[2];
const out = process.argv[3];
mkdirSync(out, { recursive: true });
const chrome = await launch(9341);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, total = 0;
try {
  for (const lang of ['ru', 'en', 'kk']) {
    for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1024, 768], [1280, 800], [1440, 900]]) {
      const p = await chrome.newPage();
      await p.viewport(w, h, { mobile: w < 768 });
      await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('qamqor.lang','${lang}');` });
      await p.goto(base + '/', 1500);
      await p.eval(`document.querySelector('.stats-block').scrollIntoView({ block: 'center' })`);
      await sleep(1800);
      const r = await p.eval(`(() => {
        const root = document.querySelector('.stats-block');
        const clipped = [...root.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !(e instanceof SVGElement)).map((e) => e.className + ':' + e.scrollWidth + '>' + e.clientWidth);
        const cards = [...root.querySelectorAll('.stat')].map((c) => { const b = c.getBoundingClientRect(); return b.left >= -0.5 && b.right <= innerWidth + 0.5; });
        const nums = [...root.querySelectorAll('.stat-n')].map((n) => { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(), c = n.closest('.stat').getBoundingClientRect(); return b.right <= c.right + 0.5; });
        return { clipped, cardsInView: cards.every(Boolean), numsInCard: nums.every(Boolean), pageOverflow: document.documentElement.scrollWidth > innerWidth, fs: getComputedStyle(root.querySelector('.stat-n')).fontSize };
      })()`);
      const ok = r.clipped.length === 0 && r.cardsInView && r.numsInCard && !r.pageOverflow;
      total++; if (!ok) bad++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${lang} ${w}  numFont=${r.fs} ${ok ? '' : JSON.stringify(r)}`);
      writeFileSync(join(out, `stats-${lang}-${w}.png`), await p.shot());
      p.close();
    }
  }
} finally { await chrome.close(); }
console.log(`\n${total - bad}/${total} combinations without clipping`);
process.exit(bad ? 1 : 0);
