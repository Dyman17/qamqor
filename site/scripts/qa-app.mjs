#!/usr/bin/env node
// QA for the dashboard against a MOCKED /api/v1 (scripts/qa-mock-api.mjs). Never talks to a real API, never creates accounts.
//   node scripts/qa-app.mjs http://127.0.0.1:4173 <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';
import { mockSource } from './qa-mock-api.mjs';

const base = process.argv[2];
const out = process.argv[3];
mkdirSync(out, { recursive: true });
const chrome = await launch(9337);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: Boolean(ok), extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(w, h, setup = '', lang = 'ru') {
  const p = await chrome.newPage();
  await p.viewport(w, h, { mobile: w < 768 });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('qamqor.lang','${lang}'); ${mockSource()} ${setup}` });
  return p;
}
const text = (p, sel = 'body') => p.eval(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const shot = async (p, name) => writeFileSync(join(out, `${name}.png`), await p.shot());
const overflow = (p) => p.eval('document.documentElement.scrollWidth > innerWidth');
const login = async (p) => {
  await p.goto(base + '/login', 800);
  await p.eval(`(() => { const e = document.getElementById('email'); e.value = 'qa@example.test'; const pw = document.getElementById('password'); pw.value = 'password123'; document.getElementById('form').requestSubmit(); })()`);
  await sleep(1500);
};

try {
  // ---- login states ----
  let p = await open(375, 812);
  await p.goto(base + '/login', 800);
  await shot(p, 'login-375');
  await p.eval(`window.__mock.loginError = 401; document.getElementById('email').value='a@b.co'; document.getElementById('password').value='x'; document.getElementById('form').requestSubmit()`);
  await sleep(700);
  check('login: wrong credentials message', (await text(p)).includes('Неверный email или пароль'));
  check('login: focus moved to first invalid field', await p.eval(`document.activeElement?.id === 'password'`));
  await shot(p, 'login-error-401-375');
  await p.eval(`window.__mock.loginError = 429; document.getElementById('form').requestSubmit()`);
  await sleep(700);
  check('login: rate limited message', (await text(p)).includes('Слишком много попыток'));
  await p.eval(`window.__mock.loginError = null; window.__mock.network = true; document.getElementById('form').requestSubmit()`);
  await sleep(700);
  check('login: network message', (await text(p)).includes('Нет подключения к сети'));
  await p.eval(`document.getElementById('email').value='bad'; document.getElementById('form').requestSubmit()`);
  await sleep(300);
  check('login: invalid email message', (await text(p)).includes('Проверьте email'));
  check('login: no overflow 375', !(await overflow(p)));
  p.close();

  p = await open(1440, 900);
  await p.goto(base + '/login', 800);
  await shot(p, 'login-1440');
  check('login: no overflow 1440', !(await overflow(p)));
  p.close();

  p = await open(320, 640);
  await p.goto(base + '/register', 800);
  await shot(p, 'register-320');
  check('register: no overflow 320', !(await overflow(p)));
  await p.eval(`document.getElementById('fullName').value='QA'; document.getElementById('email').value='qa@example.test'; document.getElementById('password').value='password123'; document.getElementById('form').requestSubmit()`);
  await sleep(700);
  check('register: email taken message', (await text(p)).includes('уже зарегистрирован'));
  p.close();

  // ---- dashboard, owner ----
  const sizes = [[1440, 900], [1280, 800], [768, 1024], [375, 812], [320, 640]];
  for (const [w, h] of sizes) {
    p = await open(w, h);
    await login(p);
    check(`app ${w}: redirected to the map`, await p.eval(`location.pathname === '/app/map'`));
    await sleep(3500);
    await shot(p, `map-${w}`);
    check(`map ${w}: no overflow`, !(await overflow(p)));
    check(`map ${w}: map canvas or fallback notice present`, await p.eval(`Boolean(document.querySelector('.maplibregl-canvas')) || !document.getElementById('map-notice').hidden`));
    for (const [route, nm] of [['/app/herd', 'herd'], ['/app/alerts', 'alerts'], ['/app/collars', 'collars'], ['/app/collars/COLLAR-01', 'collar'], ['/app/herd/a1', 'animal'], ['/app/settings', 'settings']]) {
      await p.eval(`history.pushState(null,'','${route}'); dispatchEvent(new PopStateEvent('popstate'))`);
      await sleep(900);
      await shot(p, `${nm}-${w}`);
      check(`${nm} ${w}: no overflow`, !(await overflow(p)));
    }
    p.close();
  }

  // ---- content checks (1280) ----
  p = await open(1280, 800);
  await login(p);
  await sleep(1200);
  check('owner: nav has Карта/Стадо/Оповещения/Ошейники', (await text(p, '.side')).includes('Оповещения'));
  await p.eval(`history.pushState(null,'','/app/collars'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
  check('collars: owner sees "Подключить устройство"', (await text(p, '#page-actions')).includes('Подключить устройство'));
  check('collars: offline rule text', (await text(p)).includes('15 минут'));
  check('collars: no battery wording', !/заряд|батаре/i.test(await text(p)));
  await p.eval(`history.pushState(null,'','/app/herd'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
  check('herd: table has column headers', (await p.eval(`document.querySelectorAll('table.herd-table th[scope="col"]').length`)) === 7);

  // ---- connect flow ----
  await p.eval(`history.pushState(null,'','/app/collars/connect'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
  check('connect: step 1 shown', (await text(p)).includes('Шаг 1 из 3'));
  await p.eval(`document.getElementById('did').value='ab'; document.getElementById('did').dispatchEvent(new Event('input')); document.getElementById('f1').requestSubmit()`); await sleep(300);
  check('connect: invalid id blocked', (await text(p)).includes('Проверьте идентификатор'));
  await p.eval(`document.getElementById('did').value='TAKEN'; document.getElementById('did').dispatchEvent(new Event('input')); document.getElementById('f1').requestSubmit()`); await sleep(700);
  check('connect: CONFLICT message', (await text(p)).includes('Такой идентификатор уже занят'));
  await p.eval(`document.getElementById('did').value='COLLAR-77'; document.getElementById('did').dispatchEvent(new Event('input')); document.getElementById('f1').requestSubmit()`); await sleep(900);
  check('connect: step 2 shows the secret once', (await text(p, '#v-secret')).replace(/\s/g, '').includes('k3Xq9TfA7mZb2LwR8vNc5HdY1sPe4UgJ'));
  check('connect: continue disabled before the checkbox', await p.eval(`document.getElementById('next').disabled === true`));
  await shot(p, 'connect-step2-1280');
  check('connect: secret not in localStorage/sessionStorage/URL', await p.eval(`!JSON.stringify({...localStorage, ...sessionStorage}).includes('k3Xq9T') && !location.href.includes('k3Xq9T')`));
  await p.eval(`document.getElementById('copy-secret').click()`); await sleep(500);
  check('connect: copy gives feedback (clipboard or fallback hint)', (await text(p, '#copy-secret')).includes('Скопировано') || await p.eval(`!document.getElementById('copy-hint').hidden`));
  await p.eval(`document.getElementById('toggle').click()`); await sleep(100);
  check('connect: hide masks the key', (await text(p, '#v-secret')).includes('••••'));
  await p.eval(`document.getElementById('saved').click()`); await sleep(100);
  check('connect: continue enabled after the checkbox', await p.eval(`document.getElementById('next').disabled === false`));
  await p.eval(`document.getElementById('next').click()`); await sleep(1000);
  check('connect: step 3 shown', (await text(p)).includes('Шаг 3 из 3'));
  check('connect: secret wiped from the DOM after step 2', !(await p.eval(`document.body.innerHTML.includes('k3Xq9T')`)));
  await shot(p, 'connect-step3-waiting-1280');
  await p.eval(`window.__mock.online = true`); await sleep(13000);
  check('connect: step 3 reaches "Ошейник на связи"', (await text(p, '#live')).includes('Ошейник на связи'));
  await shot(p, 'connect-step3-online-1280');

  // leave guard on step 2
  await p.eval(`history.pushState(null,'','/app/collars/connect'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(700);
  await p.eval(`document.getElementById('did').value='COLLAR-78'; document.getElementById('did').dispatchEvent(new Event('input')); document.getElementById('f1').requestSubmit()`); await sleep(900);
  await p.eval(`document.querySelector('a[href="/app/herd"]')?.click()`); await sleep(500);
  check('connect: leaving step 2 asks for confirmation (dialog)', await p.eval(`Boolean(document.querySelector('.modal[role="dialog"]'))`));
  await shot(p, 'connect-leave-dialog-1280');
  check('connect: still on the connect page', await p.eval(`location.pathname === '/app/collars/connect'`));
  p.close();

  // ---- states: empty, error, offline ----
  p = await open(1280, 800, `window.__mock.empty = true;`);
  await login(p); await sleep(1500);
  await shot(p, 'map-empty-1280');
  check('map empty state', (await text(p)).includes('В стаде пока никого'));
  for (const [route, needle, nm] of [['/app/herd', 'В стаде пока никого', 'herd'], ['/app/alerts', 'Оповещений нет', 'alerts'], ['/app/collars', 'Ошейников пока нет', 'collars']]) {
    await p.eval(`history.pushState(null,'','${route}'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
    check(`${nm} empty state`, (await text(p)).includes(needle));
    await shot(p, `${nm}-empty-1280`);
  }
  p.close();

  p = await open(1280, 800, `window.__mock.fail = '/animals';`);
  await login(p); await sleep(1500);
  check('map error state with retry', (await text(p)).includes('Не удалось загрузить данные') && (await p.eval(`Boolean(document.getElementById('retry'))`)));
  check('server banner shown on 5xx', (await text(p)).includes('Не удаётся связаться с сервером'));
  await shot(p, 'map-error-1280');
  p.close();

  p = await open(1280, 800);
  await login(p); await sleep(1500);
  await p.eval(`window.__mock.network = true; history.pushState(null,'','/app/alerts'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(1500);
  await shot(p, 'alerts-network-error-1280');
  check('network failure shows banner/error', (await text(p)).includes('Нет подключения') || (await text(p)).includes('Не удалось'));
  p.close();

  // ---- worker role ----
  p = await open(1280, 800, `window.__mock.role = 'WORKER';`);
  await login(p); await sleep(1200);
  await p.eval(`history.pushState(null,'','/app/collars'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
  check('worker: no "Подключить устройство" button', !(await text(p, '#page-actions')).includes('Подключить'));
  await p.eval(`history.pushState(null,'','/app/collars/COLLAR-01'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
  check('worker: no rotate/delete buttons', await p.eval(`!document.getElementById('rotate') && !document.getElementById('remove')`));
  await p.eval(`history.pushState(null,'','/app/collars/connect'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(700);
  check('worker: connect page is forbidden', (await text(p)).includes('доступно владельцу'));
  await p.eval(`history.pushState(null,'','/app/settings'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(700);
  check('worker: settings show only the account tab', await p.eval(`document.querySelectorAll('.tab').length === 0 && document.body.innerText.includes('Настройки фермы доступны владельцу')`));
  await shot(p, 'settings-worker-1280');
  p.close();

  // ---- English ----
  p = await open(1280, 800, '', 'en');
  await login(p); await sleep(1200);
  await p.eval(`history.pushState(null,'','/app/collars'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900);
  check('en: collars page translated', (await text(p, '#page-actions')).includes('Connect a device'));
  p.close();
} finally { await chrome.close(); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
