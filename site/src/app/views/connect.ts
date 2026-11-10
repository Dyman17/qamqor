import { $, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { setLeaveGuard } from '../../router';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { ApiError, DEVICE_CODE_RE, get, net, onNet, patch, registerCollarByCode, type AnimalDto, type CollarDto } from '../api';
import { confirmDialog, copyText, errText, forbiddenState, offlineGuard } from '../common';

const POLL_MS = 10_000;
const GIVE_UP_MS = 15 * 60_000; // the contract treats a collar as offline after 3 x 300 s of silence

/** Hand-off from the collar card ("Обновить ключ"): lives in memory only, consumed once. */
let pending: { deviceId: string; secret: string } | null = null;
export function handOffSecret(deviceId: string, secret: string): void { pending = { deviceId, secret }; }

const groups4 = (s: string): string[] => s.match(/.{1,4}/g) ?? [s];

function stepper(n: number, total: number): Safe {
  const label = t('a.cn.step', { n, total });
  return html`<p class="step-label" aria-label="${label}"><span class="step-text">${label}</span><span class="step-bar" aria-hidden="true">${Array.from({ length: total }, (_x, k) => k + 1).map((i) => html`<i class="${i <= n ? 'on' : ''}"></i>`)}</span></p>`;
}

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.co.connect'));
  ctx.setActions('');
  const stopGuard = offlineGuard(document.body);
  if (!ctx.isOwner) { setHtml(el, forbiddenState()); return stopGuard; }

  // The secret exists only in this closure. Never stored, never in the URL, never logged.
  let secret: string | null = null;
  let deviceId = '';
  let total = 2; // code flow: enter the code, wait for the first signal. The key hand-off flow (rotate) has 3 steps.
  let saved = false;
  let pollTimer = 0;
  let copyTimer = 0;
  let stopNet: (() => void) | null = null;
  const beforeUnload = (e: BeforeUnloadEvent) => { if (secret && !saved) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  function setGuard(): void {
    setLeaveGuard(secret && !saved
      ? () => confirmDialog({ title: t('a.cn.leaveTitle'), text: t('a.cn.leaveText'), confirmLabel: t('a.cn.leave'), cancelLabel: t('a.cn.stay'), danger: true })
      : null);
  }
  function wipe(): void { secret = null; setLeaveGuard(null); }

  // ---------- step 1 ----------
  async function step1(): Promise<void> {
    wipe();
    total = 2;
    let animals: AnimalDto[] = [];
    try { animals = (await get<AnimalDto[]>('/animals?limit=100')).filter((a) => !a.collarId && !a.isDemo); } catch { /* optional */ }
    setHtml(el, html`<div class="narrow-page">${stepper(1, total)}<h2 class="title-1 step-title">${t('a.cn.s1')}</h2><p>${t('a.cn.intro')}</p>
      <form id="f1" class="form" novalidate>
        <div class="field"><label for="did">${t('a.cn.idLabel')}</label><input class="input num" id="did" inputmode="numeric" pattern="[0-9]{8}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="8" aria-describedby="did-hint did-err"><p class="hint" id="did-hint">${t('a.cn.idHint')}</p><p class="field-error" id="did-err" hidden></p></div>
        <div class="field"><label for="dan">${t('a.cn.animal')} <span class="opt">(${t('a.reg.optional')})</span></label><select class="select" id="dan"><option value="">${t('a.animal.f.none')}</option>${animals.map((a) => html`<option value="${a.id}">${a.name} · ${a.tag}</option>`)}</select><p class="hint">${t('a.cn.animalHint')}</p></div>
        <p class="field-error" id="f1-err" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="create" data-write>${t('a.cn.create')}</button>
      </form></div>`);
    const input = $<HTMLInputElement>('#did', el)!;
    const err = $('#did-err', el)!;
    const formErr = $('#f1-err', el)!;
    const check = (): boolean => {
      const ok = DEVICE_CODE_RE.test(input.value);
      input.toggleAttribute('aria-invalid', !ok && input.value.length > 0);
      err.hidden = ok || input.value.length === 0;
      err.textContent = t('a.cn.idBad');
      return ok;
    };
    input.addEventListener('input', () => { const d = input.value.replace(/\D/g, '').slice(0, 8); if (d !== input.value) input.value = d; check(); });
    let busy = false;
    $<HTMLFormElement>('#f1', el)!.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      if (!check()) { err.hidden = false; err.textContent = t('a.cn.idBad'); input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      busy = true; formErr.hidden = true;
      const btn = $<HTMLButtonElement>('#create', el)!;
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = t('a.cn.creating');
      try {
        const animalId = $<HTMLSelectElement>('#dan', el)!.value;
        const r = await registerCollarByCode(input.value, animalId || undefined);
        deviceId = r.collar.deviceId;
        ctx.refreshChrome();
        wipe();
        step3();
      } catch (er) {
        busy = false;
        btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = t('a.cn.create');
        formErr.textContent = er instanceof ApiError && er.code === 'CONFLICT' ? t('a.cn.idTaken')
          : er instanceof ApiError && er.code === 'VALIDATION' ? t('a.cn.idBad')
          : er instanceof ApiError && er.code === 'FORBIDDEN_ROLE' ? t('a.cn.ownerOnly') : errText(er);
        formErr.hidden = false;
      }
    });
    input.focus();
  }

  // ---------- step 2 ----------
  function step2(): void {
    if (!secret) { void step1(); return; }
    const sec = secret;
    setGuard();
    const url = `${location.origin}/api/v1/device/telemetry`;
    const allText = `${t('a.cn.fwId')}: ${deviceId}\n${t('a.cn.fwSecret')}: ${sec}\n${t('a.cn.fwUrl')}: ${url} (POST, Authorization: Bearer ${sec})`;
    setHtml(el, html`<div class="narrow-page">${stepper(2, total)}<h2 class="title-1 step-title">${t('a.cn.s2')}</h2>
      <div class="secret-card">
        <div class="warn-box" role="note">${raw(icon('warning', 24))}<p><strong>${t('a.cn.warn')}</strong></p></div>
        <div class="secret-block"><p class="label">${t('a.cn.identifier')}</p><div class="secret-row"><code class="id-val" id="v-id">${deviceId}</code><button type="button" class="btn btn-secondary btn-sm" data-copy="id">${t('a.cn.copy')}</button></div></div>
        <div class="secret-block"><p class="label" id="sec-label">${t('a.cn.secret')}</p>
          <div class="secret-row"><code class="secret-val" id="v-secret" aria-labelledby="sec-label" tabindex="0">${groups4(sec).map((g) => html`<span class="g">${g}</span> `)}</code>
          <button type="button" class="btn btn-ghost btn-sm" id="toggle" aria-pressed="false" aria-controls="v-secret">${t('a.cn.hide')}</button></div>
          <button type="button" class="btn btn-primary btn-block" id="copy-secret">${t('a.cn.copySecret')}</button>
          <p class="hint" id="copy-hint" hidden>${t('a.cn.ctrlc')}</p>
          <p class="sr-only" id="copy-live" role="status" aria-live="polite"></p>
        </div>
        <details class="fw" open><summary class="label">${t('a.cn.fw')}</summary>
          <dl class="fw-list"><div><dt>${t('a.cn.fwId')}</dt><dd><code>${deviceId}</code></dd></div><div><dt>${t('a.cn.fwSecret')}</dt><dd><code class="fw-secret" id="fw-secret"></code></dd></div><div><dt>${t('a.cn.fwUrl')}</dt><dd><code>${url}</code><br><span class="caption muted">${t('a.cn.fwUrlHow', { 'ключ': '…', key: '…' })}</span></dd></div></dl>
          <button type="button" class="btn btn-secondary btn-sm" data-copy="all">${t('a.cn.copyAll')}</button>
          <p class="caption muted">${t('a.cn.fwNote')}</p></details>
        <p class="field-error" id="net-note" role="alert" hidden>${t('a.cn.noNet')}</p>
        <label class="check"><input type="checkbox" id="saved"><span>${t('a.cn.saved')}</span></label>
        <button type="button" class="btn btn-primary btn-block" id="next" disabled>${t('a.cn.next')}</button>
      </div></div>`);
    const fwSecret = $('#fw-secret', el)!;
    fwSecret.textContent = sec;
    const secEl = $('#v-secret', el)!;
    secEl.addEventListener('copy', (e) => { e.clipboardData?.setData('text/plain', sec); e.preventDefault(); });
    let hidden = false;
    $('#toggle', el)!.addEventListener('click', (e) => {
      hidden = !hidden;
      secEl.innerHTML = hidden ? '<span class="g">••••</span> <span class="g">••••</span> <span class="g">••••</span> <span class="g">••••</span>' : groups4(sec).map((g) => `<span class="g">${g}</span> `).join('');
      fwSecret.textContent = hidden ? '••••••••' : sec;
      (e.currentTarget as HTMLElement).textContent = hidden ? t('a.cn.show') : t('a.cn.hide');
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(hidden));
    });
    const flash = (btn: HTMLElement, label: string, restore: string, live?: string): void => {
      btn.textContent = label;
      if (live) $('#copy-live', el)!.textContent = live;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => { btn.textContent = restore; const l = $('#copy-live', el); if (l) l.textContent = ''; }, 3000);
    };
    $('#copy-secret', el)!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLElement;
      if (await copyText(sec)) { $('#copy-hint', el)!.hidden = true; flash(btn, t('a.cn.copied'), t('a.cn.copySecret'), t('a.cn.copiedLive')); }
      else { // no Clipboard API: select the key so Ctrl+C works
        if (hidden) $('#toggle', el)!.click();
        const sel = window.getSelection();
        sel?.removeAllRanges();
        const r = document.createRange(); r.selectNodeContents(secEl); sel?.addRange(r);
        $('#copy-hint', el)!.hidden = false;
      }
    });
    el.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const text = b.dataset.copy === 'id' ? deviceId : allText;
      const orig = b.textContent ?? '';
      if (await copyText(text)) flash(b, t('a.cn.copied'), orig);
    }));
    const next = $<HTMLButtonElement>('#next', el)!;
    $<HTMLInputElement>('#saved', el)!.addEventListener('change', (e) => { saved = (e.target as HTMLInputElement).checked; next.disabled = !saved; setGuard(); });
    next.addEventListener('click', () => { if (saved) { wipe(); step3(); } });
    // losing the network after creation: the key is already on screen and the request is never repeated
    const netNote = $('#net-note', el)!;
    stopNet?.();
    netNote.hidden = !net.offline;
    stopNet = onNet((s) => { netNote.hidden = !s.offline; });
  }

  // after the first signal of a collar without an animal: offer to bind it right away
  async function offerBind(id: string): Promise<void> {
    let free: AnimalDto[] = [];
    try { free = (await get<AnimalDto[]>('/animals?limit=100')).filter((a) => !a.collarId && !a.isDemo); } catch { /* binding is optional */ }
    const box = $('#s3-actions', el);
    if (!box || !el.isConnected) return;
    const link = html`<a class="btn btn-secondary" href="/app/collars/${encodeURIComponent(id)}">${t('a.cn.goCollar')}</a>`;
    if (!free.length) { box.innerHTML = link.s; return; }
    box.innerHTML = html`<div class="field"><label for="bind-an">${t('a.co.assign')}</label><select class="select" id="bind-an"><option value="">${t('a.co.pick')}</option>${free.map((a) => html`<option value="${a.id}">${a.name} · ${a.tag}</option>`)}</select></div>
      <p class="field-error" id="bind-err" role="alert" hidden></p>
      <button type="button" class="btn btn-primary" id="bind-go" disabled>${t('a.cn.bind')}</button>${link}`.s;
    const sel = $<HTMLSelectElement>('#bind-an', el)!, go = $<HTMLButtonElement>('#bind-go', el)!;
    sel.addEventListener('change', () => { go.disabled = !sel.value; });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await patch(`/devices/${encodeURIComponent(id)}`, { animalId: sel.value });
        box.innerHTML = html`<p role="status"><strong>${t('a.cn.bound')}</strong></p>${link}`.s;
        ctx.refreshChrome();
      } catch (e) { const er = $('#bind-err', el)!; er.textContent = errText(e); er.hidden = false; go.disabled = false; }
    });
  }

  // ---------- step 3 ----------
  function step3(): void {
    stopNet?.(); stopNet = null;
    const started = Date.now();
    setHtml(el, html`<div class="narrow-page">${stepper(total, total)}<h2 class="title-1 step-title">${t('a.cn.s3')}</h2><p>${t('a.cn.s3text')}</p>
      <div class="live-status" id="live" role="status" aria-live="polite"></div><p class="caption muted" id="paused" hidden>${t('a.cn.paused')}</p>
      <div class="row-actions" id="s3-actions"></div></div>`);
    const live = $('#live', el)!;
    const actions = $('#s3-actions', el)!;
    const waiting = () => { live.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span><span>${t('a.cn.waiting')}</span>`; actions.innerHTML = ''; };
    waiting();
    const poll = async () => {
      window.clearTimeout(pollTimer);
      const paused = $('#paused', el);
      if (!paused) return;
      paused.hidden = !net.offline;
      if (!net.offline) {
        try {
          const c = await get<CollarDto>(`/devices/${encodeURIComponent(deviceId)}`);
          if (!el.isConnected) return;
          if (c.status === 'ONLINE' || c.lastSeenAt) { // an unbound collar is UNASSIGNED but has a lastSeenAt once it pinged
            const unbound = !c.animalId;
            live.innerHTML = `<span class="ok-mark" aria-hidden="true">${icon('check-circle', 28)}</span><strong>${unbound ? t('a.cn.signal') : t('a.cn.online')}</strong>`;
            if (unbound) { await offerBind(c.deviceId); return; }
            actions.innerHTML = `<a class="btn btn-primary" href="/app/collars/${encodeURIComponent(deviceId)}">${t('a.cn.goCollar')}</a><a class="btn btn-secondary" href="/app/collars/connect" id="another">${t('a.cn.another')}</a>`;
            $('#another', el)!.addEventListener('click', (ev) => { ev.preventDefault(); void step1(); });
            return;
          }
        } catch { /* keep waiting; the banner shows the network state */ }
      }
      if (Date.now() - started > GIVE_UP_MS) {
        live.innerHTML = `<span>${t('a.cn.timeout')}</span>`;
        actions.innerHTML = `<button type="button" class="btn btn-primary" id="again">${t('a.cn.again')}</button><a class="btn btn-secondary" href="/app/collars">${t('a.cn.finish')}</a>`;
        $('#again', el)!.addEventListener('click', () => step3());
        return;
      }
      pollTimer = window.setTimeout(poll, POLL_MS);
    };
    pollTimer = window.setTimeout(poll, 2000);
  }

  if (pending) { total = 3; deviceId = pending.deviceId; secret = pending.secret; pending = null; saved = false; step2(); } else void step1();

  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    window.clearTimeout(pollTimer); window.clearTimeout(copyTimer);
    stopNet?.();
    wipe();
    stopGuard();
  };
};
