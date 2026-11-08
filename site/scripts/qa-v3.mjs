#!/usr/bin/env node
// v3 QA: section screenshots, header + menu keyboard checks, reduced-motion path, rough frame time. Needs a dev/preview server.
//   node scripts/qa-v3.mjs http://127.0.0.1:5199 <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const chrome = await launch(9341);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rep = {};
try {
  const open = async (w, h, reduced = false) => {
    const page = await chrome.newPage();
    await page.viewport(w, h, { mobile: w < 768, reducedMotion: reduced });
    await page.goto(base + '/x-warm');
    await page.eval(`localStorage.setItem('qamqor.lang','ru')`);
    await page.goto(base + '/', 3500);
    return page;
  };
  const jump = (page, sel) => page.eval(`(async()=>{document.documentElement.style.scrollBehavior='auto';document.querySelector(${JSON.stringify(sel)}).scrollIntoView({behavior:'instant'});await new Promise(r=>setTimeout(r,1800));})()`);

  // sections at three widths, both motion modes at 1280
  for (const [w, h, red] of [[1280, 800, false], [375, 812, false], [1280, 800, true]]) {
    const page = await open(w, h, red);
    const tag = `${w}${red ? '-reduce' : ''}`;
    const r = { overflow: null };
    for (const sel of ['#problems', '#how', '#app', '#specs', '#faq', '.site-footer']) {
      await jump(page, sel);
      writeFileSync(join(out, `v3-${tag}-${sel.replace(/[#.]/g, '')}.jpg`), await page.shot('jpeg', 70));
    }
    r.overflow = await page.eval(`document.documentElement.scrollWidth > innerWidth`);
    r.errors = [...page.logs];
    r.glassCount = await page.eval(`[...document.querySelectorAll('.landing *, .landing')].filter(e=>{const s=getComputedStyle(e);return (s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none')}).length`);
    r.layout = await page.eval(`document.querySelector('.landing').dataset.layout`);
    r.hiddenTextReduce = red ? await page.eval(`[...document.querySelectorAll('.rv,.split .w')].filter(e=>getComputedStyle(e).opacity==='0').length`) : null;
    r.dotCanvasVisible = await page.eval(`[...document.querySelectorAll('.dotfield canvas')].map(c=>getComputedStyle(c).display)`);
    rep[tag] = r;
    page.close();
  }

  // header: heights, scroll shrink, nav current
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [375, 812], [320, 640]]) {
    const page = await open(w, h);
    const a = await page.eval(`document.getElementById('site-header').offsetHeight`);
    await page.eval(`window.scrollTo(0, 400)`); await sleep(700);
    const b = await page.eval(`({h:document.getElementById('site-header').offsetHeight, over:document.documentElement.scrollWidth>innerWidth, navWrap:(()=>{const n=document.querySelector('.hnav');return n&&n.offsetParent?[...n.children].map(c=>c.getBoundingClientRect().height):null})()})`);
    rep[`header-${w}`] = { top: a, scrolled: b.h, overflow: b.over, linkHeights: b.navWrap };
    if (w === 1024 || w === 1440) { writeFileSync(join(out, `v3-header-${w}.jpg`), await page.shot('jpeg', 70)); }
    page.close();
  }

  // mobile menu: open, focus trap, Esc, focus return, scroll lock
  {
    const page = await open(375, 812);
    const key = (k, code) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code ?? k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 9 }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code ?? k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 9 }));
    await page.eval(`document.getElementById('menu-btn').focus()`);
    await page.eval(`document.getElementById('menu-btn').click()`); await sleep(700);
    const m = {};
    m.open = await page.eval(`({exp:document.getElementById('menu-btn').getAttribute('aria-expanded'), hidden:document.getElementById('menu').hidden, focus:document.activeElement.className||document.activeElement.tagName, lock:getComputedStyle(document.documentElement).overflow})`);
    writeFileSync(join(out, 'v3-menu-375.jpg'), await page.shot('jpeg', 70));
    const seen = new Set();
    for (let i = 0; i < 14; i++) { await key('Tab', 'Tab'); seen.add(await page.eval(`(document.activeElement.closest('#menu')?'in':'OUT')+':'+(document.activeElement.textContent||'').trim().slice(0,14)`)); }
    m.tabSeen = [...seen];
    await key('Escape', 'Escape'); await sleep(300);
    m.closed = await page.eval(`({exp:document.getElementById('menu-btn').getAttribute('aria-expanded'), hidden:document.getElementById('menu').hidden, focusIsBtn:document.activeElement.id==='menu-btn', lock:getComputedStyle(document.documentElement).overflow})`);
    rep.menu = m;
    page.close();
  }

  // language dropdown at 1280
  {
    const page = await open(1280, 800);
    await page.eval(`document.getElementById('lang-btn').click()`); await sleep(200);
    rep.langDropdown = await page.eval(`({exp:document.getElementById('lang-btn').getAttribute('aria-expanded'), items:[...document.querySelectorAll('#lang-panel button')].map(b=>b.textContent+':'+b.getAttribute('aria-current'))})`);
    writeFileSync(join(out, 'v3-lang-dropdown-1280.jpg'), await page.shot('jpeg', 70));
    page.close();
  }

  // frame time / loop idle: sample rAF deltas while moving the cursor and scrolling the stage
  {
    const page = await open(1280, 720);
    const res = await page.eval(`(async()=>{
      const dts=[]; let last=performance.now(); let run=true;
      const loop=(n)=>{dts.push(n-last); last=n; if(run) requestAnimationFrame(loop)}; requestAnimationFrame(loop);
      const s=document.getElementById('stage'); const top=s.getBoundingClientRect().top+scrollY; const tot=s.offsetHeight-innerHeight;
      const t0=performance.now();
      while(performance.now()-t0<3000){ const k=(performance.now()-t0)/3000; window.scrollTo(0, top+k*0.9*tot); window.dispatchEvent(new PointerEvent('pointermove',{clientX:200+k*800,clientY:300+Math.sin(k*9)*120,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,16)); }
      run=false; const d=dts.slice(5); d.sort((a,b)=>a-b);
      return {frames:d.length, avgMs:+(d.reduce((a,b)=>a+b,0)/d.length).toFixed(1), p95:+d[Math.floor(d.length*.95)].toFixed(1), fps:+(1000/(d.reduce((a,b)=>a+b,0)/d.length)).toFixed(1)};
    })()`);
    rep.frameTimeScroll = res;
    // idle: count rAF callbacks over 2 s with no input (page effects should be asleep; the stage ambient runs at ~30 fps)
    await sleep(1500);
    rep.idleRaf2s = await page.eval(`(async()=>{let n=0;const o=window.requestAnimationFrame;window.requestAnimationFrame=(f)=>{n++;return o.call(window,f)};await new Promise(r=>setTimeout(r,2000));window.requestAnimationFrame=o;return n})()`);
    page.close();
  }
} finally { await chrome.close(); }
console.log(JSON.stringify(rep, null, 2));
