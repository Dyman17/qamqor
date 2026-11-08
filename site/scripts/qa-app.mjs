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
const nav = async (p, route) => { await p.eval(`history.pushState(null,'','${route}'); dispatchEvent(new PopStateEvent('popstate'))`); await sleep(900); };

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

  // ---- connect flow (8-digit device code) ----
  await nav(p, '/app/collars/connect');
  check('connect: step 1 shown (2 steps)', (await text(p)).includes('Шаг 1 из 2'));
  await p.eval(`document.getElementById('did').value='ab12cd34'; document.getElementById('did').dispatchEvent(new Event('input'))`);
  check('connect: non-digits are stripped', await p.eval(`document.getElementById('did').value === '1234'`));
  await p.eval(`document.getElementById('f1').requestSubmit()`); await sleep(300);
  check('connect: short code blocked', (await text(p)).includes('Код состоит ровно из 8 цифр'));
  await p.eval(`window.__mock.calls.length = 0; document.getElementById('did').value='11111111'; document.getElementById('did').dispatchEvent(new Event('input')); document.getElementById('f1').requestSubmit()`); await sleep(700);
  check('connect: CONFLICT message', (await text(p)).includes('Этот код уже зарегистрирован'));
  await p.eval(`document.getElementById('did').value='12345678'; document.getElementById('did').dispatchEvent(new Event('input')); document.getElementById('f1').requestSubmit()`); await sleep(900);
  check('connect: POST /devices sent', await p.eval(`window.__mock.calls.some((c) => c === 'POST /devices')`));
  check('connect: step 2 of 2 (waiting for the first signal)', (await text(p)).includes('Шаг 2 из 2'));
  await shot(p, 'connect-step2-waiting-1280');
  await p.eval(`window.__mock.online = true`); await sleep(13000);
  check('connect: reaches "Ошейник на связи"', (await text(p, '#live')).includes('Ошейник на связи'));
  p.close();

  // ---- demo modes: owner ----
  p = await open(1280, 800);
  await login(p); await sleep(1500);
  check('demo: no strip in REAL', await p.eval(`document.getElementById('demo-strip').hidden`));
  await nav(p, '/app/settings');
  await p.eval(`document.querySelector('[data-tab="data"]').click()`); await sleep(700);
  check('demo: settings has 3 mode radios', (await p.eval(`document.querySelectorAll('input[name="mode"]').length`)) === 3);
  await shot(p, 'settings-data-1280');
  check('demo: no backdrop-filter anywhere in the page', await p.eval(`[...document.querySelectorAll('*')].every((e) => (getComputedStyle(e).backdropFilter || 'none') === 'none')`));
  await p.eval(`document.querySelector('input[value="MANUAL"]').click()`); await sleep(900);
  check('demo: strip shows manual text', (await text(p, '#demo-strip')).includes('Демо · ручной режим'));
  await nav(p, '/app/map');
  await sleep(3500);
  check('demo: manual panel present', await p.eval(`Boolean(document.getElementById('d-an')) && Boolean(document.querySelector('[data-ev="BREACH"]'))`));
  check('demo: demo animal has the square demo marker or list marker', await p.eval(`Boolean(document.querySelector('.amark.demo')) || Boolean(document.querySelector('.mk.demo'))`));
  await p.eval(`document.querySelector('[data-ev="BREACH"]').click()`); await sleep(1200);
  check('demo: collar response text shown', (await text(p, '#d-result')).includes('Ответ ошейника: зона RED'));
  await p.eval(`document.getElementById('d-border').click()`); await sleep(1200);
  check('demo: step to the border sends telemetry', await p.eval(`window.__mock.calls.some((c) => c === 'POST /farms/farm1/simulate/telemetry')`));
  await p.eval(`document.getElementById('d-lat').value='99'; document.getElementById('d-lat').dispatchEvent(new Event('input')); document.getElementById('d-send').click()`); await sleep(400);
  check('demo: bad coordinates are rejected before sending', (await text(p, '.demo-panel')).includes('Введите широту'));
  await shot(p, 'map-demo-manual-1280');
  await nav(p, '/app/herd');
  check('demo: herd rows carry the Демо tag', (await p.eval(`document.querySelectorAll('.demo-tag').length`)) > 0);
  await nav(p, '/app/settings');
  await p.eval(`document.querySelector('[data-tab="data"]').click()`); await sleep(500);
  await p.eval(`document.querySelector('input[value="AUTO"]').click()`); await sleep(900);
  check('demo: strip shows simulation text', (await text(p, '#demo-strip')).includes('симуляция, не настоящие животные'));
  await nav(p, '/app/map');
  await sleep(3000);
  check('demo: auto controls present', await p.eval(`Boolean(document.getElementById('a-stop')) && document.querySelectorAll('[data-speed]').length === 4`));
  await p.eval(`document.querySelector('[data-speed="5"]').click()`); await sleep(700);
  check('demo: speed PATCH applied', await p.eval(`window.__mock.speed === 5`));
  await shot(p, 'map-demo-auto-1280');
  await nav(p, '/app/settings');
  await p.eval(`document.querySelector('[data-tab="data"]').click()`); await sleep(500);
  await p.eval(`document.querySelector('input[value="REAL"]').click()`); await sleep(500);
  check('demo: leaving demo asks for confirmation (dialog)', await p.eval(`Boolean(document.querySelector('.modal[role="dialog"]'))`));
  await p.eval(`document.querySelector('.modal [data-act="ok"]').click()`); await sleep(1000);
  check('demo: strip hidden again in REAL', await p.eval(`document.getElementById('demo-strip').hidden`));
  p.close();

  for (const [w, h] of [[375, 812], [320, 640]]) {
    p = await open(w, h, `window.__mock.mode = 'MANUAL'; window.__mock.addDemo();`);
    await login(p); await sleep(3500);
    await shot(p, `map-demo-manual-${w}`);
    check(`demo ${w}: map no overflow`, !(await overflow(p)));
    await nav(p, '/app/settings');
    await p.eval(`document.querySelector('[data-tab="data"]').click()`); await sleep(500);
    check(`demo ${w}: settings no overflow`, !(await overflow(p)));
    await shot(p, `settings-data-${w}`);
    p.close();
  }

  // worker sees the mode and the Демо marks, but no panel and no switch
  p = await open(1280, 800, `window.__mock.role = 'WORKER'; window.__mock.mode = 'AUTO'; window.__mock.addDemo();`);
  await login(p); await sleep(3000);
  check('demo worker: strip visible', (await text(p, '#demo-strip')).includes('Демо'));
  check('demo worker: no demo panel', await p.eval(`document.getElementById('demo-box').hidden`));
  await nav(p, '/app/settings');
  check('demo worker: mode radios disabled', await p.eval(`document.querySelectorAll('input[name="mode"]').length === 3 && [...document.querySelectorAll('input[name="mode"]')].every((r) => r.disabled)`));
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
  await p.eval(`document.querySelector('[data-tab="account"]').click()`); await sleep(300);
  check('worker: settings show only data+account tabs', await p.eval(`document.querySelectorAll('.tab').length === 2 && document.body.innerText.includes('Настройки фермы доступны владельцу')`));
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
