import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const DIST_DIR = path.resolve('site/dist');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT_DIR = path.resolve('site/qa-screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Simple static file server for site/dist
function createServer() {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };

  const server = http.createServer((req, res) => {
    let filePath = path.join(DIST_DIR, req.url.split('?')[0]);
    if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(4188, '127.0.0.1', () => {
      console.log('Static QA server running on http://127.0.0.1:4188');
      resolve(server);
    });
  });
}

async function run() {
  const server = await createServer();
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    // 1. Desktop Test
    console.log('Testing Desktop (1280x800)...');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.setRequestInterception(true);
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERR:', err.message));
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/')) console.log('REQ:', req.method(), url);
      if (url.includes('/api/v1/auth/me')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: { id: 'u1', fullName: 'Dyman17', email: 'duman@qamqor.kz' } })
        });
      } else if (url.includes('/api/v1/farms')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'f1', name: 'Dumans farm', timezone: 'Asia/Almaty', myRole: 'OWNER', workerCanEditBoundaries: true, dataMode: 'REAL' }])
        });
      } else if (url.includes('/api/v1/animals/a1/events')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ alerts: [], signals: { day: '2026-11-10', sound: { used: 3, limit: 10 }, vibration: { used: 1, limit: 5 } } })
        });
      } else if (url.includes('/api/v1/animals/a1')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'a1', farmId: 'f1', name: 'Esp32 (Акбас)', tag: '12345678', species: 'CATTLE', status: 'ok',
            collarId: '12345678', lat: 43.6521, lng: 51.1584, accuracyM: 4.2, lastSeenAt: new Date().toISOString(),
            lastHeartRate: 74, lastHeartRateAt: new Date().toISOString(),
            controlMode: 'GPS_MANUAL',
            controlModeSince: new Date(Date.now() - 600000).toISOString(),
            controlModeExpiresAt: new Date(Date.now() + 7100000).toISOString(),
            positionSource: 'MANUAL',
            pulseThreat: {
              level: 'NORMAL',
              score: 18,
              labelRu: 'В норме (покой)',
              labelKk: 'Қалыпты (тыныш)',
              labelEn: 'Normal (resting)',
              normalMin: 60,
              normalMax: 84,
              baseline: 70,
              deltaPercent: 6,
              source: 'Merck Veterinary Manual (Physiologic Constants: Cattle)',
              sourceNoteRu: 'Взрослый КРС в покое: 60–84 уд/мин (телята: 100–120 уд/мин). Пульс > 105 указывает на острый стресс / угрозу хищника.',
              isAssumption: false
            }
          })
        });
      } else if (url.includes('/api/v1/animals')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: 'a1', farmId: 'f1', name: 'Esp32 (Акбас)', tag: '12345678', species: 'CATTLE', status: 'ok',
            collarId: '12345678', lat: 43.6521, lng: 51.1584, accuracyM: 4.2, lastSeenAt: new Date().toISOString(),
            controlMode: 'GPS_MANUAL', positionSource: 'MANUAL', lastHeartRate: 74,
            pulseThreat: { level: 'NORMAL', score: 18, labelRu: 'В норме (покой)', normalMin: 60, normalMax: 84, baseline: 70, deltaPercent: 6 }
          }])
        });
      } else if (url.includes('/api/v1/geofences')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      } else if (url.includes('/api/v1/devices')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ deviceId: '12345678', code: '12345678', status: 'OFFLINE', animalId: 'a1' }])
        });
      } else if (url.includes('/api/v1/device/stream')) {
        req.respond({ status: 200, contentType: 'text/event-stream', body: '' });
      } else {
        req.continue();
      }
    });

    // Seed session token before loading
    await page.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('qamqor.lang', 'ru');
      sessionStorage.setItem('qamqor.token', 'mock_token_for_qa');
      sessionStorage.setItem('qamqor.farm', 'f1');
    });

    await page.goto('http://127.0.0.1:4188/app/map', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 800));

    // Capture initial map desktop
    await page.screenshot({ path: path.join(OUT_DIR, '01_desktop_map_initial.png') });
    console.log('Saved 01_desktop_map_initial.png');

    // Click draw button #m-draw
    await page.click('#m-draw');
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT_DIR, '02_desktop_map_drawing_bar.png') });
    console.log('Saved 02_desktop_map_drawing_bar.png');

    // Click 3 points on the map container
    const mapEl = await page.$('#map');
    const box = await mapEl.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.click(cx - 100, cy - 100);
    await new Promise((r) => setTimeout(r, 200));
    await page.mouse.click(cx + 100, cy - 100);
    await new Promise((r) => setTimeout(r, 200));
    await page.mouse.click(cx, cy + 100);
    await new Promise((r) => setTimeout(r, 400));

    await page.screenshot({ path: path.join(OUT_DIR, '03_desktop_map_drawing_ready.png') });
    console.log('Saved 03_desktop_map_drawing_ready.png');

    // Animal Profile Test (Desktop): Merck pulse norm + 3 collar modes
    await page.goto('http://127.0.0.1:4188/app/herd/a1', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(OUT_DIR, '03b_desktop_animal_profile.png') });
    console.log('Saved 03b_desktop_animal_profile.png');

    await page.close();

    // 2. Mobile Test (iPhone 14 / modern Android 390x844)
    console.log('Testing Mobile (390x844)...');
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    await mobilePage.setRequestInterception(true);
    mobilePage.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/v1/auth/me')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: { id: 'u1', fullName: 'Dyman17', email: 'duman@qamqor.kz' } })
        });
      } else if (url.includes('/api/v1/farms')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'f1', name: 'Dumans farm', timezone: 'Asia/Almaty', myRole: 'OWNER', workerCanEditBoundaries: true, dataMode: 'REAL' }])
        });
      } else if (url.includes('/api/v1/animals/a1/events')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ alerts: [], signals: { day: '2026-11-10', sound: { used: 3, limit: 10 }, vibration: { used: 1, limit: 5 } } })
        });
      } else if (url.includes('/api/v1/animals/a1')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'a1', farmId: 'f1', name: 'Esp32 (Акбас)', tag: '12345678', species: 'CATTLE', status: 'ok',
            collarId: '12345678', lat: 43.6521, lng: 51.1584, accuracyM: 4.2, lastSeenAt: new Date().toISOString(),
            lastHeartRate: 74, lastHeartRateAt: new Date().toISOString(),
            controlMode: 'GPS_MANUAL',
            controlModeSince: new Date(Date.now() - 600000).toISOString(),
            controlModeExpiresAt: new Date(Date.now() + 7100000).toISOString(),
            positionSource: 'MANUAL',
            pulseThreat: {
              level: 'NORMAL',
              score: 18,
              labelRu: 'В норме (покой)',
              labelKk: 'Қалыпты (тыныш)',
              labelEn: 'Normal (resting)',
              normalMin: 60,
              normalMax: 84,
              baseline: 70,
              deltaPercent: 6,
              source: 'Merck Veterinary Manual (Physiologic Constants: Cattle)',
              sourceNoteRu: 'Взрослый КРС в покое: 60–84 уд/мин (телята: 100–120 уд/мин). Пульс > 105 указывает на острый стресс / угрозу хищника.',
              isAssumption: false
            }
          })
        });
      } else if (url.includes('/api/v1/animals')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: 'a1', farmId: 'f1', name: 'Esp32 (Акбас)', tag: '12345678', species: 'CATTLE', status: 'ok',
            collarId: '12345678', lat: 43.6521, lng: 51.1584, accuracyM: 4.2, lastSeenAt: new Date().toISOString(),
            controlMode: 'GPS_MANUAL', positionSource: 'MANUAL', lastHeartRate: 74,
            pulseThreat: { level: 'NORMAL', score: 18, labelRu: 'В норме (покой)', normalMin: 60, normalMax: 84, baseline: 70, deltaPercent: 6 }
          }])
        });
      } else if (url.includes('/api/v1/geofences')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      } else if (url.includes('/api/v1/devices')) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ deviceId: '12345678', code: '12345678', status: 'OFFLINE', animalId: 'a1' }])
        });
      } else if (url.includes('/api/v1/device/stream')) {
        req.respond({ status: 200, contentType: 'text/event-stream', body: '' });
      } else {
        req.continue();
      }
    });

    await mobilePage.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await mobilePage.evaluate(() => {
      localStorage.setItem('qamqor.lang', 'ru');
      sessionStorage.setItem('qamqor.token', 'mock_token_for_qa');
      sessionStorage.setItem('qamqor.farm', 'f1');
    });

    await mobilePage.goto('http://127.0.0.1:4188/app/map', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 800));

    await mobilePage.screenshot({ path: path.join(OUT_DIR, '04_mobile_map_initial.png') });
    console.log('Saved 04_mobile_map_initial.png');

    await mobilePage.click('#m-draw');
    await new Promise((r) => setTimeout(r, 400));

    await mobilePage.screenshot({ path: path.join(OUT_DIR, '05_mobile_map_drawing_bar.png') });
    console.log('Saved 05_mobile_map_drawing_bar.png');

    const mBox = await (await mobilePage.$('#map')).boundingBox();
    const mcx = mBox.x + mBox.width / 2;
    const mcy = mBox.y + mBox.height / 2;

    await mobilePage.mouse.click(mcx - 60, mcy - 60);
    await new Promise((r) => setTimeout(r, 200));
    await mobilePage.mouse.click(mcx + 60, mcy - 60);
    await new Promise((r) => setTimeout(r, 200));
    await mobilePage.mouse.click(mcx, mcy + 60);
    await new Promise((r) => setTimeout(r, 400));

    await mobilePage.screenshot({ path: path.join(OUT_DIR, '06_mobile_map_drawing_ready.png') });
    console.log('Saved 06_mobile_map_drawing_ready.png');

    // Animal Profile Test (Mobile): Merck pulse norm + 3 collar modes
    await mobilePage.goto('http://127.0.0.1:4188/app/herd/a1', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    await mobilePage.screenshot({ path: path.join(OUT_DIR, '06b_mobile_animal_profile.png') });
    console.log('Saved 06b_mobile_animal_profile.png');

    await mobilePage.close();
  } finally {
    await browser.close();
    server.close();
    console.log('QA run completed successfully!');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
