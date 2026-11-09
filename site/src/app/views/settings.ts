import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { getLang, langSwitcherHtml, bindLangSwitch, applyI18n, t } from '../../i18n';
import { navigate } from '../../router';
import type { AppCtx, AppView } from '../app';
import { ApiError, del, get, patch, post, put, setSession, simApi, type DataMode, type FarmDto, type InvitationDto, type MembersResponse, type SignalLimitDto, type SimulationDto } from '../api';
import { modeName, retryBusy, setSim } from '../demo';
import { confirmDialog, copyText, errText, loadInto, offlineGuard, timeEl, toast } from '../common';

type Tab = 'farm' | 'data' | 'people' | 'signals' | 'account';

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.set.title'));
  ctx.setActions('');
  const stop = offlineGuard(document.body);
  const tabs: Tab[] = ctx.isOwner ? ['farm', 'data', 'people', 'signals', 'account'] : ['data', 'account'];
  let tab: Tab = (ctx.query.get('tab') as Tab) && tabs.includes(ctx.query.get('tab') as Tab) ? (ctx.query.get('tab') as Tab) : tabs[0];
  setHtml(el, html`<div class="settings">
    ${tabs.length > 1 ? html`<nav class="tabs" aria-label="${t('a.set.title')}">${tabs.map((x) => html`<button type="button" class="tab" data-tab="${x}" aria-current="${x === tab}">${t(`a.set.${x}` as 'a.set.farm')}</button>`)}</nav>` : ''}
    <div class="tab-body" id="tab-body"></div></div>`);
  const body = $('#tab-body', el)!;
  const go = (x: Tab) => {
    tab = x;
    $$('.tab', el).forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === x)));
    if (x === 'farm') farmTab(body, ctx); else if (x === 'data') dataTab(body, ctx); else if (x === 'people') peopleTab(body, ctx); else if (x === 'signals') signalsTab(body, ctx); else accountTab(body, ctx);
  };
  $$('.tab', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.tab as Tab)));
  go(tab);
  return stop;
};

function farmTab(el: HTMLElement, ctx: AppCtx): void {
  const f = ctx.farm;
  setHtml(el, html`<form class="form narrow-form" id="ff" novalidate>
    <div class="field"><label for="fn">${t('a.set.farmName')}</label><input class="input" id="fn" value="${f.name}" required></div>
    <div class="field"><label for="fd">${t('a.set.farmDesc')}</label><input class="input" id="fd" value="${f.description ?? ''}"></div>
    <div class="field"><label for="ftz">${t('a.set.tz')}</label><input class="input" id="ftz" value="${f.timezone}"></div>
    <label class="check"><input type="checkbox" id="fw" ${f.workerCanEditBoundaries ? raw('checked') : ''} aria-describedby="fw-h"><span>${t('a.set.workerEdit')}</span></label><p class="hint" id="fw-h">${t('a.set.workerEditHint')}</p>
    <p class="field-error" id="ferr" role="alert" hidden></p><p class="form-ok" id="fok" role="status" hidden></p>
    <button class="btn btn-primary" type="submit" data-write>${t('a.set.save')}</button></form>`);
  $<HTMLFormElement>('#ff', el)!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#ferr', el)!, ok = $('#fok', el)!;
    err.hidden = true; ok.hidden = true;
    const name = $<HTMLInputElement>('#fn', el)!.value.trim();
    if (!name) { err.textContent = t('a.err.required'); err.hidden = false; return; }
    try {
      const nf = await patch<FarmDto>(`/farms/${f.id}`, { name, description: $<HTMLInputElement>('#fd', el)!.value.trim(), timezone: $<HTMLInputElement>('#ftz', el)!.value.trim(), workerCanEditBoundaries: $<HTMLInputElement>('#fw', el)!.checked });
      Object.assign(ctx.farm, nf);
      ok.textContent = t('a.set.saved'); ok.hidden = false;
    } catch (er) { err.textContent = errText(er); err.hidden = false; }
  });
}

const MODES: DataMode[] = ['REAL', 'MANUAL', 'AUTO'];

/** Data mode of the farm: owners switch, workers see the current mode. Leaving a demo mode deletes the demo data, so it asks first. */
function dataTab(el: HTMLElement, ctx: AppCtx): void {
  const fid = ctx.farm.id;
  void loadInto(el, () => simApi.get(fid), (s0) => {
    let s: SimulationDto = s0;
    setSim(s, fid);
    const draw = (err = '') => {
      const locked = !ctx.isOwner || !s.enabled;
      setHtml(el, html`<form class="form narrow-form" id="dm" novalidate>
        <h2 class="title-2">${t('a.set.data.title')}</h2>
        <p class="muted">${t('a.set.data.intro')}</p>
        <fieldset class="mode-set" aria-describedby="dm-note"><legend class="sr-only">${t('a.set.data.title')}</legend>
          ${MODES.map((m) => html`<label class="mode-opt ${m === s.dataMode ? 'on' : ''}"><input type="radio" name="mode" value="${m}" ${m === s.dataMode ? raw('checked') : ''} ${locked ? raw('disabled') : ''}><span><strong>${t(`a.set.data.${m}` as 'a.set.data.REAL')}</strong><span class="caption muted">${t(`a.set.data.${m}.d` as 'a.set.data.REAL.d')}</span></span></label>`)}
        </fieldset>
        <p class="hint" id="dm-note">${!s.enabled ? t('a.set.data.off') : !ctx.isOwner ? t('a.set.data.worker') : t('a.set.data.current', { mode: modeName(s.dataMode) })}</p>
        <p class="field-error" role="alert" ${err ? '' : raw('hidden')}>${err}</p>
      </form>`);
      $$<HTMLInputElement>('input[name="mode"]', el).forEach((r) => r.addEventListener('change', async () => {
        const mode = r.value as DataMode;
        if (mode === s.dataMode) return;
        if (mode === 'REAL' && !await confirmDialog({ title: t('a.set.data.confirmTitle'), text: t('a.set.data.confirmText'), confirmLabel: t('a.set.data.confirm'), danger: true })) { draw(); return; }
        $$<HTMLInputElement>('input[name="mode"]', el).forEach((x) => { x.disabled = true; });
        try {
          s = await retryBusy(() => simApi.setMode(fid, mode), () => toast(t('a.demo.retrying')));
          setSim(s, fid);
          ctx.farm.dataMode = s.dataMode;
          draw();
          toast(t('a.set.data.done', { mode: modeName(s.dataMode) }));
        } catch (e) { draw(errText(e)); }
      }));
    };
    draw();
  });
}

function peopleTab(el: HTMLElement, ctx: AppCtx): void {
  const fid = ctx.farm.id;
  void loadInto(el, () => get<MembersResponse>(`/farms/${fid}/members`), (m) => {
    const pending = m.invitations.filter((i: InvitationDto) => i.status === 'PENDING');
    setHtml(el, html`
      <section class="panel-block"><h2 class="title-2">${t('a.set.members')}</h2>
        <ul class="people">${m.members.map((x) => html`<li><span><strong>${x.fullName}</strong><span class="caption muted"> ${x.email} · ${x.role === 'OWNER' ? t('a.set.owner') : t('a.set.worker')}</span></span>${x.role === 'WORKER' ? html`<button type="button" class="btn btn-ghost btn-sm" data-remove="${x.userId}" data-name="${x.fullName}" data-write>${t('a.set.remove')}</button>` : ''}</li>`)}</ul></section>
      <section class="panel-block"><h2 class="title-2">${t('a.set.invites')}</h2>
        ${m.invitations.length ? html`<ul class="people">${m.invitations.map((i) => html`<li><span>${i.email} <span class="caption muted">· ${t(`a.set.inv.${i.status}` as 'a.set.inv.PENDING')} · ${timeEl(i.expiresAt)}</span></span>${i.status === 'PENDING' ? html`<button type="button" class="btn btn-ghost btn-sm" data-revoke="${i.id}" data-write>${t('a.set.revoke')}</button>` : ''}</li>`)}</ul>` : ''}
        <form class="form narrow-form" id="inv" novalidate><div class="field"><label for="ie">${t('a.set.inviteEmail')}</label><input class="input" id="ie" type="email" autocomplete="off" inputmode="email"></div>
          <p class="field-error" id="ierr" role="alert" hidden></p><div id="iresult" role="status"></div>
          <button class="btn btn-primary" type="submit" data-write>${t('a.set.inviteSend')}</button></form></section>`);
    void pending;
    const reload = () => peopleTab(el, ctx);
    $$('[data-remove]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.set.removeTitle'), text: t('a.set.removeText', { name: b.dataset.name! }), confirmLabel: t('a.set.remove'), danger: true })) return;
      try { await del(`/farms/${fid}/members/${b.dataset.remove}`); reload(); } catch (e) { toast(errText(e)); }
    }));
    $$('[data-revoke]', el).forEach((b) => b.addEventListener('click', async () => { try { await del(`/farms/${fid}/invitations/${b.dataset.revoke}`); reload(); } catch (e) { toast(errText(e)); } }));
    $<HTMLFormElement>('#inv', el)!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#ierr', el)!, res = $('#iresult', el)!;
      err.hidden = true; res.innerHTML = '';
      const email = $<HTMLInputElement>('#ie', el)!.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = t('a.err.email'); err.hidden = false; return; }
      try {
        const r = await post<InvitationDto & { delivered: boolean; inviteUrl?: string }>(`/farms/${fid}/invitations`, { email, lang: getLang() });
        if (!r.delivered && r.inviteUrl) {
          res.innerHTML = html`<div class="warn-box" role="note"><p>${t('a.set.noMail')}</p></div><p><code class="invite-url">${r.inviteUrl}</code></p><button type="button" class="btn btn-secondary btn-sm" id="copy-inv">${t('a.set.copyLink')}</button>`.s;
          $('#copy-inv', res)!.addEventListener('click', async (ev) => { const b = ev.currentTarget as HTMLElement; if (await copyText(r.inviteUrl!)) { b.textContent = t('a.copied'); } else toast(t('a.copy.fail')); });
        } else { toast(t('a.set.invited')); reload(); }
      } catch (er) { err.textContent = er instanceof ApiError && er.status === 409 ? er.message : errText(er); err.hidden = false; }
    });
  });
}

function signalsTab(el: HTMLElement, ctx: AppCtx): void {
  const fid = ctx.farm.id;
  void loadInto(el, () => get<SignalLimitDto[]>(`/farms/${fid}/signal-limits`), (all) => {
    const levels = [['SOUND', t('a.set.sound')], ['VIBRATION', t('a.set.vibration')]] as const;
    const find = (l: string) => all.find((x) => x.level === l);
    setHtml(el, html`<form class="form narrow-form" id="sl" novalidate><h2 class="title-2">${t('a.set.limits')}</h2>
      ${levels.map(([lvl, name]) => { const x = find(lvl); const un = x?.unlimited ?? false; return html`<fieldset class="limit-row"><legend>${name}</legend>
        <div class="field"><label for="l-${lvl}">${t('a.set.limit')}</label><input class="input num" id="l-${lvl}" type="number" min="1" step="1" inputmode="numeric" value="${x?.dailyLimit ?? ''}" ${un ? raw('disabled') : ''} aria-describedby="e-${lvl}"><p class="field-error" id="e-${lvl}" hidden></p></div>
        <label class="check"><input type="checkbox" data-un="${lvl}" ${un ? raw('checked') : ''}><span>${t('a.set.unlimited')}</span></label></fieldset>`; })}
      <p class="field-error" id="serr" role="alert" hidden></p><p class="form-ok" id="sok" role="status" hidden></p>
      <button class="btn btn-primary" type="submit" data-write>${t('a.set.save')}</button></form>`);
    $$('[data-un]', el).forEach((c) => c.addEventListener('change', () => { $<HTMLInputElement>(`#l-${c.dataset.un}`, el)!.disabled = (c as HTMLInputElement).checked; }));
    $<HTMLFormElement>('#sl', el)!.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#sok', el)!.hidden = true; $('#serr', el)!.hidden = true;
      const out: SignalLimitDto[] = [];
      let bad = false;
      for (const [lvl] of levels) {
        const un = $<HTMLInputElement>(`[data-un="${lvl}"]`, el)!.checked;
        const inp = $<HTMLInputElement>(`#l-${lvl}`, el)!;
        const err = $(`#e-${lvl}`, el)!;
        err.hidden = true;
        if (un) { out.push({ level: lvl, dailyLimit: null, unlimited: true }); continue; }
        const v = inp.value.trim() === '' ? null : Number(inp.value);
        if (v !== null && (!Number.isInteger(v) || v < 1)) { err.textContent = t('a.set.limitBad'); err.hidden = false; inp.setAttribute('aria-invalid', 'true'); bad = true; continue; }
        inp.removeAttribute('aria-invalid');
        out.push({ level: lvl, dailyLimit: v, unlimited: false });
      }
      if (bad) return;
      const imp = find('IMPULSE'); if (imp) out.push(imp); // not shown, sent back unchanged
      try { await put<SignalLimitDto[]>(`/farms/${fid}/signal-limits`, out); const ok = $('#sok', el)!; ok.textContent = t('a.set.saved'); ok.hidden = false; }
      catch (er) { const se = $('#serr', el)!; se.textContent = errText(er); se.hidden = false; }
    });
  });
}

function accountTab(el: HTMLElement, ctx: AppCtx): void {
  const u = ctx.user;
  const info: Safe = html`<dl class="kv"><div><dt>${t('a.set.name')}</dt><dd>${u.fullName}</dd></div><div><dt>${t('a.set.email')}</dt><dd>${u.email}</dd></div></dl>`;
  setHtml(el, html`<section class="panel-block">${info}
    <div class="field"><span class="label">${t('a.set.lang')}</span>${raw(langSwitcherHtml('on-light'))}</div>
    ${ctx.isOwner ? '' : html`<p class="muted">${t('a.set.workerNote')}</p>`}
    <button type="button" class="btn btn-secondary" id="out">${t('a.nav.logout')}</button></section>`);
  bindLangSwitch(el);
  applyI18n(el);
  $('#out', el)!.addEventListener('click', () => { setSession(null); void navigate('/login', { replace: true }); });
}
