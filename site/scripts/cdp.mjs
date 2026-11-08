// Minimal Chrome DevTools Protocol driver for QA screenshots and poster baking. No dependencies (Node 22 WebSocket).
// Used by scripts/qa-shots.mjs and scripts/bake-posters.mjs. Chrome/Edge must be installed; set CHROME to override.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export async function launch(port = 9333, extraArgs = []) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found; set CHROME');
  const dir = mkdtempSync(join(tmpdir(), 'qamqor-cdp-'));
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
    '--hide-scrollbars=false', ...extraArgs, 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    port,
    async newPage() {
      const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      return connect(t.webSocketDebuggerUrl);
    },
    async close() { proc.kill(); await new Promise((r) => setTimeout(r, 400)); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  const logs = [];
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) {
      listeners.forEach((l) => l(m));
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push(`log error: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  return opened.then(async () => {
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
    const api = {
      send, logs,
      async viewport(width, height, { mobile = false, dsf = 1, reducedMotion = false } = {}) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile });
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
      },
      async goto(u, wait = 1500) {
        const loaded = new Promise((res) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); res(); } }; listeners.push(l); });
        await send('Page.navigate', { url: u });
        await loaded;
        await new Promise((r) => setTimeout(r, wait));
      },
      async eval(expr) {
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      async shot(format = 'png', quality = 90) {
        const r = await send('Page.captureScreenshot', { format, quality: format === 'png' ? undefined : quality });
        return Buffer.from(r.data, 'base64');
      },
      close() { ws.close(); },
    };
    return api;
  });
}
