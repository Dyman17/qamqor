import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { getLang, langSwitcherHtml, bindLangSwitch, applyI18n, t } from '../../i18n';
import { navigate } from '../../router';
import type { AppCtx, AppView } from '../app';
import { ApiError, del, get, patch, post, put, setSession, simApi, type AnimalDto, type CollarResponseDto, type DataMode, type FarmDto, type InvitationDto, type MembersResponse, type PenDto, type SignalLimitDto, type SimEvent, type SimSpeed, type SimulationDto } from '../api';
import { collarResponseText, modeName, retryBusy, setSim } from '../demo';
import { confirmDialog, copyText, errText, loadInto, offlineGuard, timeEl, toast } from '../common';

type Tab = 'farm' | 'data' | 'people' | 'signals' | 'account';

// local flat-earth geometry: a point `insideM` metres inside the nearest border of the pen
function nearestBorderInside(pen: PenDto, lat: number, lng: number, insideM: number): { lat: number; lng: number } | null {
  if (!pen.polygon?.coordinates?.[0]) return null;
  const ring = pen.polygon.coordinates[0];
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 110574;
  const P = { x: lng * kx, y: lat * ky };
  let best: { x: number; y: number; d: number } | null = null;
  for (let i = 0; i < ring.length - 1; i++) {
    const A = { x: ring[i][0] * kx, y: ring[i][1] * ky };
    const B = { x: ring[i + 1][0] * kx, y: ring[i + 1][1] * ky };
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const Q = { x: A.x + u * dx, y: A.y + u * dy };
    const d = Math.hypot(P.x - Q.x, P.y - Q.y);
    if (!best || d < best.d) best = { ...Q, d };
  }
  if (!best) return null;
  const d = best.d || 1;
  const ux = (P.x - best.x) / d;
  const uy = (P.y - best.y) / d;
  return { lat: (best.y + uy * insideM) / ky, lng: (best.x + ux * insideM) / kx };
}

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

const MODES: { v: DataMode; label: string }[] = [
  { v: 'REAL', label: 'Реальный' },
  { v: 'MANUAL', label: 'Пилотный' },
  { v: 'AUTO', label: 'Автоматический' },
];
const SPEEDS: SimSpeed[] = [1, 2, 5, 10];
const EVENTS: { v: SimEvent; label: string }[] = [
  { v: 'BREACH', label: 'Выход за границу' },
  { v: 'ESCAPE', label: 'Побег' },
  { v: 'RETURN', label: 'Возврат' },
  { v: 'GPS_LOST', label: 'Потеря GPS' },
  { v: 'COLLAR_OFFLINE', label: 'Ошейник молчит' },
  { v: 'COLLAR_ONLINE', label: 'Связь есть' },
];

/** Data mode & simulation controls (matching mobile ModeSection.tsx). Owners switch and test, workers inspect. */
function dataTab(el: HTMLElement, ctx: AppCtx): void {
  const fid = ctx.farm.id;
  let selectedId: string | null = null;
  let latS = '';
  let lngS = '';
  let speed: SimSpeed = 1;
  let last: CollarResponseDto | null = null;
  let busy = false;
  let msg: { text: string; error?: boolean } | null = null;

  void loadInto(el, async () => {
    const [s, animals, pens] = await Promise.all([
      simApi.get(fid),
      get<AnimalDto[]>('/animals?limit=100').catch(() => [] as AnimalDto[]),
      get<PenDto[]>('/geofences').catch(() => [] as PenDto[]),
    ]);
    return { s, animals, pens };
  }, ({ s: s0, animals: a0, pens: p0 }) => {
    let s: SimulationDto = s0;
    let animals: AnimalDto[] = a0;
    let pens: PenDto[] = p0;
    setSim(s, fid);
    speed = (s.speed as SimSpeed) || 1;

    const reloadData = async () => {
      try {
        const [freshS, freshA, freshP] = await Promise.all([
          simApi.get(fid),
          get<AnimalDto[]>('/animals?limit=100').catch(() => [] as AnimalDto[]),
          get<PenDto[]>('/geofences').catch(() => [] as PenDto[]),
        ]);
        s = freshS; animals = freshA; pens = freshP;
        setSim(s, fid);
        draw();
      } catch {}
    };

    const run = async (fn: () => Promise<string | void>) => {
      busy = true; msg = null;
      draw();
      try {
        const text = await fn();
        if (text) msg = { text };
      } catch (e) {
        msg = { text: errText(e), error: true };
      } finally {
        busy = false;
        draw();
      }
    };

    const draw = () => {
      const demoAnimals = animals.filter((a) => a.isDemo);
      if (!selectedId && demoAnimals.length > 0) {
        selectedId = demoAnimals[0].id;
      }
      const current = demoAnimals.find((a) => a.id === selectedId);
      if (current && current.lat != null && current.lng != null && !latS && !lngS) {
        latS = current.lat.toFixed(5);
        lngS = current.lng.toFixed(5);
      }

      const locked = !ctx.isOwner || !s.enabled;

      setHtml(el, html`
        <div class="panel-block">
          <h2 class="title-2">${t('a.set.data.title')}</h2>
          <p class="muted" style="margin-bottom:1rem;">${t('a.set.data.intro')}</p>

          <!-- Селектор режимов -->
          <div class="chips" role="group" aria-label="${t('a.set.data.title')}" style="margin-bottom:1rem;">
            ${MODES.map((m) => html`
              <button type="button" class="chip-btn ${m.v === s.dataMode ? 'active' : ''}" data-mode="${m.v}" ${locked ? raw('disabled') : ''} style="min-height:40px;padding:0.4rem 1rem;font-weight:600;border-radius:var(--radius-pill);cursor:pointer;background:${m.v === s.dataMode ? 'var(--primary)' : 'var(--surface-2)'};color:${m.v === s.dataMode ? '#fff' : 'inherit'};border:1px solid var(--border-subtle);">
                ${m.label}
              </button>
            `)}
          </div>

          <!-- Режим: REAL -->
          ${s.dataMode === 'REAL' ? html`
            <p class="caption muted">${t('a.set.data.REAL.d')}</p>
          ` : ''}

          <!-- Режим: AUTO (Автоматическая симуляция сценариев) -->
          ${s.dataMode === 'AUTO' ? html`
            <div style="display:flex;flex-direction:column;gap:var(--space-3);padding-top:0.5rem;border-top:1px solid var(--border-subtle);">
              <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
                <span class="badge ${s.running ? 'badge-online' : ''}"><span class="dot"></span> ${s.running ? t('a.demo.running') : t('a.demo.stopped')}</span>
                <span class="caption muted">животных: <strong class="num">${s.demo.animals}</strong> · демо-оповещений: <strong class="num">${s.demo.alerts}</strong></span>
                ${s.until ? html`<span class="caption muted">(${t('a.demo.left')}: ${new Date(s.until).toLocaleTimeString()})</span>` : ''}
              </div>

              <div>
                <label class="caption muted" style="display:block;margin-bottom:0.35rem;font-weight:600;">${t('a.demo.speed')}:</label>
                <div class="chips" style="gap:0.4rem;">
                  ${SPEEDS.map((sp) => html`
                    <button type="button" class="btn btn-secondary btn-sm" data-speed="${sp}" style="${speed === sp ? 'background:var(--primary);color:#fff;border-color:var(--primary);' : ''}min-width:44px;font-weight:700;">
                      x${sp}
                    </button>
                  `)}
                </div>
              </div>

              <div class="row-actions" style="flex-wrap:wrap;gap:0.5rem;margin-top:0.25rem;">
                ${s.running
                  ? html`<button type="button" class="btn btn-secondary btn-sm" id="btn-stop-sim" ${busy ? raw('disabled') : ''}>${t('a.demo.stop')}</button>`
                  : html`<button type="button" class="btn btn-primary btn-sm" id="btn-start-sim" ${busy ? raw('disabled') : ''}>${t('a.demo.start')}</button>`}
                <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-sim" ${busy ? raw('disabled') : ''}>${t('a.demo.reset')}</button>
              </div>
            </div>
          ` : ''}

          <!-- Режим: MANUAL (Пилотный - ручное управление и события) -->
          ${s.dataMode === 'MANUAL' ? html`
            <div style="display:flex;flex-direction:column;gap:var(--space-3);padding-top:0.5rem;border-top:1px solid var(--border-subtle);">
              <div>
                <label class="caption muted" style="display:block;margin-bottom:0.35rem;font-weight:600;">${t('a.demo.animal')}:</label>
                <div class="chips" style="gap:0.4rem;flex-wrap:wrap;">
                  ${demoAnimals.map((da) => html`
                    <button type="button" class="btn btn-sm ${selectedId === da.id ? 'btn-primary' : 'btn-secondary'}" data-select-demo="${da.id}">
                      ${da.name}
                    </button>
                  `)}
                  <button type="button" class="btn btn-secondary btn-sm" id="btn-add-demo" ${busy ? raw('disabled') : ''}>+ ${t('a.demo.add')}</button>
                </div>
              </div>

              ${current ? html`
                <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:0.75rem;border:1px solid var(--border-subtle);">
                  <p class="caption muted" style="margin-bottom:0.4rem;">
                    <strong>${current.name}</strong> · ${t('a.demo.pos')}:
                    <span class="font-mono num">${current.lat != null && current.lng != null ? `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}` : 'не задана'}</span>
                  </p>
                  <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
                    <input type="text" class="input font-mono num" id="sim-lat" placeholder="${t('a.demo.lat')}" value="${latS}" style="max-width:140px;min-height:38px;">
                    <input type="text" class="input font-mono num" id="sim-lng" placeholder="${t('a.demo.lng')}" value="${lngS}" style="max-width:140px;min-height:38px;">
                    <button type="button" class="btn btn-primary btn-sm" id="btn-send-pos" ${busy ? raw('disabled') : ''}>${t('a.demo.send')}</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-to-border" ${busy ? raw('disabled') : ''}>${t('a.demo.stepBorder')}</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-out-border" ${busy ? raw('disabled') : ''}>${t('a.demo.stepOut')}</button>
                  </div>
                </div>

                <div>
                  <label class="caption muted" style="display:block;margin-bottom:0.35rem;font-weight:600;">${t('a.demo.events')}:</label>
                  <div class="chips" style="gap:0.4rem;flex-wrap:wrap;">
                    ${EVENTS.map((ev) => html`
                      <button type="button" class="btn btn-secondary btn-sm" data-fire-event="${ev.v}" ${busy ? raw('disabled') : ''}>
                        ${ev.label}
                      </button>
                    `)}
                  </div>
                </div>

                ${last ? html`
                  <p class="caption muted font-mono" style="background:var(--surface-0);padding:0.5rem;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
                    ${t('a.demo.r.prefix', { text: collarResponseText(last) })}
                  </p>
                ` : ''}
              ` : ''}
            </div>
          ` : ''}

          ${msg ? html`<p class="caption ${msg.error ? 'field-error' : 'form-ok'}" style="margin-top:0.75rem;">${msg.text}</p>` : ''}
        </div>
      `);

      // Event handlers
      $$('[data-mode]', el).forEach((btn) => btn.addEventListener('click', async () => {
        const m = (btn as HTMLElement).dataset.mode as DataMode;
        if (m === s.dataMode || busy) return;
        if (m === 'REAL' && !await confirmDialog({ title: t('a.set.data.confirmTitle'), text: t('a.set.data.confirmText'), confirmLabel: t('a.set.data.confirm'), danger: true })) return;
        void run(async () => {
          if (m === 'AUTO') {
            s = await retryBusy(() => simApi.start(fid, { speed }), () => toast(t('a.demo.retrying')));
          } else {
            s = await retryBusy(() => simApi.setMode(fid, m), () => toast(t('a.demo.retrying')));
          }
          ctx.farm.dataMode = s.dataMode;
          await reloadData();
          return t('a.set.data.done', { mode: modeName(s.dataMode) });
        });
      }));

      $$('[data-speed]', el).forEach((btn) => btn.addEventListener('click', () => {
        const sp = Number((btn as HTMLElement).dataset.speed) as SimSpeed;
        speed = sp;
        void run(async () => {
          if (s.running) s = await simApi.setSpeed(fid, sp);
        });
      }));

      $('#btn-start-sim', el)?.addEventListener('click', () => void run(async () => {
        s = await simApi.start(fid, { speed });
        await reloadData();
        return t('a.demo.running');
      }));

      $('#btn-stop-sim', el)?.addEventListener('click', () => void run(async () => {
        s = await simApi.stop(fid);
        await reloadData();
        return t('a.demo.stopped');
      }));

      $('#btn-reset-sim', el)?.addEventListener('click', async () => {
        if (!await confirmDialog({ title: t('a.demo.resetTitle'), text: t('a.demo.resetText'), confirmLabel: t('a.demo.reset'), danger: true })) return;
        void run(async () => {
          s = await simApi.reset(fid);
          await reloadData();
          return t('a.demo.resetDone');
        });
      });

      $$('[data-select-demo]', el).forEach((btn) => btn.addEventListener('click', () => {
        selectedId = (btn as HTMLElement).dataset.selectDemo!;
        const curr = animals.find((a) => a.id === selectedId);
        if (curr && curr.lat != null && curr.lng != null) {
          latS = curr.lat.toFixed(5);
          lngS = curr.lng.toFixed(5);
        }
        draw();
      }));

      $('#btn-add-demo', el)?.addEventListener('click', () => void run(async () => {
        const added = await simApi.addAnimal(fid, {});
        selectedId = added.id;
        await reloadData();
        return t('a.demo.added', { name: added.name });
      }));

      $('#btn-send-pos', el)?.addEventListener('click', () => {
        const latVal = parseFloat(($('#sim-lat', el) as HTMLInputElement)?.value.replace(',', '.') ?? '');
        const lngVal = parseFloat(($('#sim-lng', el) as HTMLInputElement)?.value.replace(',', '.') ?? '');
        if (!isFinite(latVal) || !isFinite(lngVal) || Math.abs(latVal) > 90 || Math.abs(lngVal) > 180) {
          toast(t('a.demo.coordsBad'));
          return;
        }
        if (!selectedId) return;
        latS = latVal.toFixed(5);
        lngS = lngVal.toFixed(5);
        void run(async () => {
          last = await simApi.telemetry(fid, { animalId: selectedId!, lat: latVal, lng: lngVal });
          await reloadData();
          return t('a.demo.r.ok');
        });
      });

      $('#btn-to-border', el)?.addEventListener('click', () => {
        const pen = pens.find((p) => p.id === current?.penId) ?? pens.find((p) => p.isDemo) ?? pens[0];
        if (!pen || !current || current.lat == null || current.lng == null) {
          toast(t('a.demo.noPen'));
          return;
        }
        const pt = nearestBorderInside(pen, current.lat, current.lng, 3);
        if (!pt) { toast(t('a.demo.noPen')); return; }
        latS = pt.lat.toFixed(5);
        lngS = pt.lng.toFixed(5);
        void run(async () => {
          last = await simApi.telemetry(fid, { animalId: selectedId!, lat: pt.lat, lng: pt.lng });
          await reloadData();
          return t('a.demo.stepBorder');
        });
      });

      $('#btn-out-border', el)?.addEventListener('click', () => {
        if (!selectedId) return;
        void run(async () => {
          const res = await simApi.event(fid, { animalId: selectedId!, event: 'BREACH' });
          last = 'zone' in res ? res : null;
          await reloadData();
          return t('a.demo.stepOut');
        });
      });

      $$('[data-fire-event]', el).forEach((btn) => btn.addEventListener('click', () => {
        const ev = (btn as HTMLElement).dataset.fireEvent as SimEvent;
        if (!selectedId) return;
        void run(async () => {
          const res = await simApi.event(fid, { animalId: selectedId!, event: ev });
          last = 'zone' in res ? res : null;
          await reloadData();
          return t('a.demo.r.ok');
        });
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
