import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { navigate } from '../../router';
import type { AppCtx, AppView } from '../app';
import { ApiError, collarControlApi, del, get, patch, post, type AlertDto, type AnimalDto, type CollarControlMode, type CollarDto, type EventsDto, type PenDto } from '../api';
import { animalBadge, collarBadge, confirmDialog, controlModeLabel, errText, loadInto, offlineGuard, pulseThreatBadge, SPECIES, speciesName, timeEl, toast } from '../common';
import { formModal } from '../forms';
import { icon } from '../../ui/icons';
import { enterGpsManual } from '../manual-place';
import { openStream, type StreamHandle } from '../stream';

/** Create or edit an animal in a modal form (POST /animals, PATCH /animals/:id). */
export async function openAnimalForm(ctx: AppCtx, animal: AnimalDto | undefined, onSaved: () => void): Promise<void> {
  let pens: PenDto[] = [];
  let collars: CollarDto[] = [];
  try { [pens, collars] = await Promise.all([get<PenDto[]>('/geofences'), get<CollarDto[]>('/devices')]); } catch { /* the selects stay empty */ }
  const free = collars.filter((c) => !c.animalId || c.deviceId === animal?.collarId);
  void ctx;
  formModal({
    title: animal ? t('a.animal.editTitle') : t('a.animal.new'),
    submitLabel: t('a.animal.save'),
    body: html`
      <div class="field"><label for="af-name">${t('a.animal.f.name')}</label><input class="input" id="af-name" name="name" required value="${animal?.name ?? ''}" autocomplete="off"></div>
      <div class="field"><label for="af-tag">${t('a.animal.f.tag')}</label><input class="input" id="af-tag" name="tag" required value="${animal?.tag ?? ''}" autocomplete="off"></div>
      <div class="field"><label for="af-breed">${t('a.animal.f.breed')}</label><input class="input" id="af-breed" name="breed" value="${animal?.breed ?? ''}" autocomplete="off"></div>
      <div class="field"><label for="af-sp">${t('a.animal.f.species')}</label><select class="select" id="af-sp" name="species">${SPECIES.map((s) => html`<option value="${s}" ${animal?.species === s ? raw('selected') : ''}>${speciesName(s)}</option>`)}</select></div>
      <div class="field"><label for="af-pen">${t('a.animal.f.pen')}</label><select class="select" id="af-pen" name="penId"><option value="">${t('a.animal.f.none')}</option>${pens.map((p) => html`<option value="${p.id}" ${animal?.penId === p.id ? raw('selected') : ''}>${p.name}</option>`)}</select></div>
      <div class="field"><label for="af-col">${t('a.animal.f.collar')}</label><select class="select" id="af-col" name="collarId"><option value="">${t('a.animal.f.none')}</option>${free.map((c) => html`<option value="${c.deviceId}" ${animal?.collarId === c.deviceId ? raw('selected') : ''}>${c.deviceId}</option>`)}</select></div>`,
    async onSubmit(form) {
      const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
      if (!v('name') || !v('tag')) return t('a.err.required');
      try {
        if (!animal) {
          const body: Record<string, string> = { name: v('name'), tag: v('tag'), species: v('species') };
          if (v('breed')) body.breed = v('breed');
          if (v('penId')) body.penId = v('penId');
          if (v('collarId')) body.collarId = v('collarId');
          await post<AnimalDto>('/animals', body);
        } else {
          const body: Record<string, string | null> = {};
          if (v('name') !== animal.name) body.name = v('name');
          if (v('tag') !== animal.tag) body.tag = v('tag');
          if (v('breed') !== (animal.breed ?? '')) body.breed = v('breed') || null;
          if (v('species') !== animal.species) body.species = v('species');
          if ((v('penId') || null) !== animal.penId) body.penId = v('penId') || null;
          if ((v('collarId') || null) !== animal.collarId && v('collarId')) body.collarId = v('collarId');
          if (Object.keys(body).length) await patch<AnimalDto>(`/animals/${animal.id}`, body);
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFLICT') return t('a.animal.tagTaken');
        throw e;
      }
      onSaved();
    },
  });
}

const alertLabel = (a: AlertDto) => t(`a.al.t.${a.type}` as 'a.al.t.GPS_LOST');

function formatTtl(iso?: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('a.units.min', { n: 0 });
  const min = Math.ceil(ms / 60000);
  if (min < 60) return t('a.units.min', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? t('a.units.hmin', { h, m }) : t('a.units.h', { n: h });
}

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.animal.title'));
  ctx.setActions('');
  const stop = offlineGuard(document.body);
  const id = ctx.params.id;
  const alive = () => el.isConnected;
  let pollTimer: number | null = null;
  let eventSource: StreamHandle | null = null;
  let lastZoneAt = 0; // last time the stream gave a zone: the status poll must not overwrite a fresher zone with "unknown"
  let lastCritAlertTime = 0;

  const pulseInfo = (hr: number | null | undefined, at: string | null | undefined) => {
    const isLive = at ? Date.now() - new Date(at).getTime() < 15000 : false;
    const val = hr != null ? t('a.animal.bpm', { n: hr }) : '—';
    const sub = at
      ? html`${timeEl(at)} ${isLive ? html`<span class="badge badge-online" title="${t('a.animal.streamTitle')}"><span class="dot"></span> ${t('a.animal.livePulse')}</span>` : html`<span class="muted">(${t('a.animal.noFinger')})</span>`}`
      : html`${t('a.animal.noPulse')}`;
    return { val, sub, isLive };
  };

  const threatDetails = (a: AnimalDto): Safe => {
    const pt = a.pulseThreat;
    if (!pt || pt.level === 'UNKNOWN') {
      return html`
        <div class="pulse-source-box">
          <div class="pulse-source-head">
            <span>${t('a.animal.normSpecies', { species: speciesName(a.species) })} <strong>${pt?.normalMin ?? '—'}–${pt?.normalMax ?? '—'} ${t('a.animal.bpmUnit')}</strong></span>
            <span class="pulse-source-tag">${pt?.source ?? 'Merck'}</span>
          </div>
          <span class="caption muted">${t('a.animal.restNote')}</span>
        </div>`;
    }
    const sign = pt.deltaPercent > 0 ? '+' : '';
    const isCrit = pt.level === 'CRITICAL';
    const isElev = pt.level === 'ELEVATED';
    return html`
      <div class="pulse-source-box ${isCrit ? 'is-crit' : isElev ? 'is-elev' : ''}">
        <div class="pulse-source-head">
          <span>${t('a.animal.normPlain')} <strong class="num">${pt.normalMin}–${pt.normalMax}</strong> ${t('a.animal.bpmUnit')} · ${t('a.animal.baseline')} <strong class="num">${pt.baseline}</strong> (${sign}${pt.deltaPercent}%)</span>
          <span class="pulse-source-tag ${pt.isAssumption ? 'is-assumption' : ''}">
            ${pt.source ?? 'Merck Veterinary Manual'}${pt.isAssumption ? ` (${t('a.animal.pulseAssumption')})` : ''}
          </span>
        </div>
        ${pt.sourceNoteRu ? html`<p class="caption muted pulse-source-note">${pt.sourceNoteRu}</p>` : ''}
        ${isCrit ? html`<div class="pulse-crit-msg">${raw(icon('warning-circle', 16))} ${t('a.animal.pulseCritMsg')}</div>` : ''}
      </div>`;
  };

  const zoneBadge = (zone?: string | null, inFence?: boolean | null): Safe => {
    if (zone === 'GREEN' || (inFence && !zone)) {
      return html`<span class="badge badge-online"><span class="dot"></span> ${t('a.animal.zoneSafe')}</span>`;
    }
    if (zone === 'YELLOW') {
      return html`<span class="badge badge-warning"><span class="dot"></span> ${t('a.animal.zoneWarn')}</span>`;
    }
    if (zone === 'ORANGE') {
      return html`<span class="badge badge-warning"><span class="dot"></span> ${t('a.animal.zoneCrit')}</span>`;
    }
    if (zone === 'RED' || inFence === false) {
      return html`<span class="badge badge-danger"><span class="dot"></span> ${t('a.animal.zoneBreach')}</span>`;
    }
    if (zone === 'ESCAPE') {
      return html`<span class="badge badge-danger pulse-crit-badge"><span class="dot"></span> ${t('a.animal.zoneEscape')}</span>`;
    }
    return html`<span class="caption muted">${t('a.st.ok')}</span>`;
  };

  void loadInto(el, async () => {
    const [animal, ev, pens, collars] = await Promise.all([
      get<AnimalDto>(`/animals/${id}`),
      get<EventsDto>(`/animals/${id}/events`).catch(() => null),
      get<PenDto[]>('/geofences').catch(() => [] as PenDto[]),
      get<CollarDto[]>('/devices').catch(() => [] as CollarDto[]),
    ]);
    return { animal, ev, pens, collars };
  }, ({ animal: a, ev, pens, collars }) => {
    if (alive()) document.title = `${a.name} · ${a.tag} | Qamqor`; // the top bar keeps the short page title; the full name is the page heading
    ctx.setActions(html`<button type="button" class="btn btn-secondary btn-sm" id="edit" data-write>${t('a.animal.edit')}</button><button type="button" class="btn btn-danger btn-sm" id="remove" data-write>${t('a.animal.delete')}</button>`);
    const pen = pens.find((p) => p.id === a.penId);
    const sig = ev?.signals;
    const lim = (l: number | null) => (l == null ? t('a.animal.noLimit') : t('a.animal.limit', { n: l }));
    const pi = pulseInfo(a.lastHeartRate, a.lastHeartRateAt);
    const freeCollars = collars.filter((c) => !c.animalId);
    const collar = a.collarId ? collars.find((c) => c.deviceId === a.collarId) : undefined;
    const currentMode: CollarControlMode = a.controlMode ?? collar?.controlMode ?? 'AUTO';

    setHtml(el, html`
      <p><a href="/app/herd">${t('a.animal.back')}</a></p>
      <div class="profile-head animal-head">
        <div class="animal-head-main">
          <div id="badge-wrap">${animalBadge(a)}</div>
          <h2 class="title-1 animal-name">${a.name} ${a.isDemo ? html`<span class="demo-tag">${t('a.demo.tag')}</span>` : ''}</h2>
          <p class="muted animal-meta">${a.breed ? html`<strong>${a.breed}</strong> · ` : ''}${t('a.animal.f.tag')} <strong class="num">${a.tag}</strong> · ${speciesName(a.species)}</p>
        </div>
        <div class="row-actions">
          <a class="btn btn-primary btn-sm" href="/app/map?animal=${a.id}">${t('a.map.showOnMap')}</a>
        </div>
      </div>

      <div class="grid-2">
        <!-- 1. Мониторинг здоровья и пульса (Live) -->
        <section class="panel-block" aria-labelledby="h-pulse">
          <div class="card-head">
            <h2 class="title-2 with-icon" id="h-pulse">${raw(icon('heartbeat', 20))} ${t('a.animal.pulse')}</h2>
            <div id="pulse-threat-wrap">${pulseThreatBadge(a.pulseThreat)}</div>
          </div>
          <p class="num font-mono pulse-val-xl" id="pulse-val">${pi.val}</p>
          <p class="muted" id="pulse-sub">${pi.sub}</p>
          <div id="pulse-details">${threatDetails(a)}</div>
        </section>

        <!-- 2. Положение и привязка ошейника (GPS & Device) -->
        <section class="panel-block" aria-labelledby="h-pos">
          <h2 class="title-2 with-icon" id="h-pos">${raw(icon('crosshair-simple', 20))} ${t('a.animal.position')}</h2>
          <p class="num" id="pos-val">${a.lat != null && a.lng != null ? t('a.animal.coords', { lat: a.lat.toFixed(5), lng: a.lng.toFixed(5) }) : '—'}</p>
          <p class="muted" id="pos-sub">${t('a.animal.accuracy')}: ${a.accuracyM != null ? t('a.units.m', { n: Math.round(a.accuracyM) }) : '—'} · ${timeEl(a.lastSeenAt)}</p>
          <div class="collar-row">
            <span id="col-val"><span class="muted">${t('a.animal.collar')}:</span> ${a.collarId ? html`<a class="num collar-id" href="/app/collars/${a.collarId}">${a.collarId}</a>${collar ? html` ${collarBadge(collar)}` : ''}` : t('a.herd.noCollar')}</span>
            ${a.collarId ? html`<button type="button" class="btn btn-secondary btn-sm" id="unlink" data-write>${t('a.animal.unlink')}</button>` : ''}
          </div>
        </section>

        <!-- 3. Если ошейник не привязан — блок быстрой привязки (как в приложении) -->
        ${!a.collarId ? html`
          <section class="panel-block span-all assign-card" id="assign-card">
            <h2 class="title-2 with-icon">${raw(icon('cpu', 20))} ${t('a.animal.assignCollarTitle')}</h2>
            ${freeCollars.length === 0
              ? html`<p class="caption muted">${t('a.animal.noFreeCollars')}</p>`
              : html`
                <p class="caption muted">${t('a.animal.pickFreeCollar')}</p>
                <div class="row-actions">
                  ${freeCollars.map((c) => html`
                    <div class="free-collar">
                      <span class="font-mono num free-collar-id">${c.code ?? c.deviceId}</span>
                      ${collarBadge(c)}
                      <button type="button" class="btn btn-primary btn-sm" data-assign-collar="${c.deviceId}">${t('a.animal.assignBtn')}</button>
                    </div>
                  `)}
                </div>
              `}
          </section>
        ` : ''}

        <!-- 4. Единый блок управления: СМЕНА РЕЖИМОВ (AUTO / GPS_MANUAL / MANUAL) -->
        <section class="panel-block span-all" id="ctrl-mode-card">
          <div class="card-head mode-head">
            <div class="mode-head-title">
              <h2 class="title-2 with-icon">${raw(icon('gear-six', 20))} ${t('a.animal.modeTitle')}</h2>
              <div id="mode-ttl-wrap">
                ${a.controlModeExpiresAt && currentMode !== 'AUTO' ? html`
                  <span class="mode-ttl-badge" title="${t('a.animal.modeTtlTitle')}">${raw(icon('clock', 14))} ${t('a.animal.modeAutoTtl', { time: formatTtl(a.controlModeExpiresAt) })}</span>
                ` : ''}
              </div>
            </div>
            <!-- Переключатель 3 режимов -->
            <div class="tabs mode-tabs" role="tablist" aria-label="${t('a.animal.modeTitle')}">
              <button type="button" class="tab" id="mode-tab-auto" role="tab" aria-selected="${currentMode === 'AUTO'}">
                ${raw(icon('map-trifold', 18))} ${t('a.animal.modeAuto')}
              </button>
              <button type="button" class="tab" id="mode-tab-gps-manual" role="tab" aria-selected="${currentMode === 'GPS_MANUAL'}">
                ${raw(icon('crosshair-simple', 18))} ${t('a.animal.modeGpsManual')}
              </button>
              <button type="button" class="tab" id="mode-tab-manual" role="tab" aria-selected="${currentMode === 'MANUAL'}">
                ${raw(icon('speaker-high', 18))} ${t('a.animal.modeManual')}
              </button>
            </div>
          </div>

          <!-- Режим 1: Автоматический (Геозона) -->
          <div id="mode-content-auto" style="display:${currentMode === 'AUTO' ? 'block' : 'none'};">
            <p class="caption muted">${t('a.animal.modeAutoHint')}</p>
            <div class="mode-row">
              <div id="zone-wrap">${zoneBadge(null, a.status !== 'danger')}</div>
              <div><strong>${t('a.animal.pen')}:</strong> ${pen ? html`<a href="/app/map?pen=${pen.id}">${pen.name}</a>` : t('a.herd.noPen')}</div>
            </div>
            <div id="sig-limits" class="caption muted mode-limits">
              ${sig ? html`<span>${t('a.animal.sound')}: <strong class="num">${sig.sound.used}</strong> (${lim(sig.sound.limit)}) · ${t('a.animal.vibration')}: <strong class="num">${sig.vibration.used}</strong> (${lim(sig.vibration.limit)})</span>` : html`<span>${t('a.animal.signals')}: —</span>`}
            </div>
          </div>

          <!-- Режим 2: GPS вручную (Перетаскивание точки оператором) -->
          <div id="mode-content-gps-manual" style="display:${currentMode === 'GPS_MANUAL' ? 'block' : 'none'};">
            <p class="caption muted">${t('a.animal.modeGpsManualHint')}</p>
            <div class="mode-row">
              <a class="btn btn-primary btn-sm" href="/app/map?animal=${a.id}&drag=1">
                ${raw(icon('crosshair-simple', 18))} ${t('a.animal.dragOnMap')}
              </a>
              <span class="caption muted">${a.lat != null && a.lng != null ? t('a.animal.coords', { lat: a.lat.toFixed(5), lng: a.lng.toFixed(5) }) : '—'}</span>
            </div>
          </div>

          <!-- Режим 3: Ручной стимул (Оператор) -->
          <div id="mode-content-manual" style="display:${currentMode === 'MANUAL' ? 'block' : 'none'};">
            <p class="caption muted">${t('a.animal.modeManualHint')}</p>
            <div class="row-actions mode-row">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-spk" ${!a.collarId ? raw('disabled') : ''} data-write>${raw(icon('speaker-high', 18))} ${t('a.animal.spkBtn')}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-buz" ${!a.collarId ? raw('disabled') : ''} data-write>${raw(icon('bell-ringing', 18))} ${t('a.animal.buzBtn')}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-vib" ${!a.collarId ? raw('disabled') : ''} data-write>${raw(icon('vibrate', 18))} ${t('a.animal.vibBtn')}</button>
            </div>
            <p class="caption muted font-mono cmd-status" id="cmd-status" role="status"></p>
          </div>
        </section>
      </div>

      <!-- 5. Журнал событий -->
      <section class="panel-block" aria-labelledby="h-ev">
        <h2 class="title-2" id="h-ev">${t('a.animal.events')}</h2>
        ${ev?.alerts.length ? html`<ul class="events">${ev.alerts.map((x) => html`<li><strong>${alertLabel(x)}</strong><span class="muted">${x.message}</span>${timeEl(x.createdAt)}</li>`)}</ul>` : html`<p class="muted">${t('a.animal.noEvents')}</p>`}
      </section>
    `);

    // Обновление DOM-элементов в реальном времени без перезагрузки всей страницы
    const applyUpdate = (fresh: Partial<AnimalDto>, zone?: string | null, inFence?: boolean | null) => {
      if (!alive()) return;
      const pFresh = pulseInfo(fresh.lastHeartRate, fresh.lastHeartRateAt);
      const pVal = $('#pulse-val', el);
      const pSub = $('#pulse-sub', el);
      const pThreat = $('#pulse-threat-wrap', el);
      const pDet = $('#pulse-details', el);
      const bWrap = $('#badge-wrap', el);
      const posVal = $('#pos-val', el);
      const posSub = $('#pos-sub', el);
      const zWrap = $('#zone-wrap', el);

      if (pVal) {
        pVal.textContent = String(pFresh.val);
        // Микро-анимация пульса при поступлении нового значения
        pVal.style.transition = 'color 0.2s ease';
        pVal.style.color = pFresh.isLive ? 'var(--ok)' : 'inherit';
        setTimeout(() => { if (pVal) pVal.style.color = 'inherit'; }, 400);
      }
      if (pSub) setHtml(pSub, pFresh.sub);
      if (pThreat && fresh.pulseThreat) setHtml(pThreat, pulseThreatBadge(fresh.pulseThreat));
      if (pDet && fresh.species) setHtml(pDet, threatDetails(fresh as AnimalDto));
      if (bWrap) setHtml(bWrap, animalBadge(fresh as AnimalDto));

      if (posVal) posVal.textContent = fresh.lat != null && fresh.lng != null ? t('a.animal.coords', { lat: fresh.lat.toFixed(5), lng: fresh.lng.toFixed(5) }) : '—';
      if (posSub) setHtml(posSub, html`${t('a.animal.accuracy')}: ${fresh.accuracyM != null ? t('a.units.m', { n: Math.round(fresh.accuracyM) }) : '—'} · ${timeEl(fresh.lastSeenAt)}`);
      if (zWrap && (zone !== undefined || inFence !== undefined)) {
        setHtml(zWrap, zoneBadge(zone, inFence));
      }
    };

    // 1. Потоковое обновление через Server-Sent Events (SSE) в реальном времени (0 ms задержки)
    try {
      eventSource = openStream({ animalId: id }, (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'telemetry') {
            if (msg.heartRate != null) {
              a.lastHeartRate = msg.heartRate;
              a.lastHeartRateAt = msg.lastHeartRateAt || msg.serverTime;
            }
            if (msg.pulseThreat) {
              a.pulseThreat = msg.pulseThreat;
              if (msg.pulseThreat.level === 'CRITICAL') {
                const now = Date.now();
                if (now - lastCritAlertTime > 25000) {
                  lastCritAlertTime = now;
                  if ('vibrate' in navigator) { try { navigator.vibrate([150, 75, 150]); } catch {} }
                  toast(t('a.animal.pulseAlarm', { name: a.name, bpm: t('a.animal.bpm', { n: msg.heartRate }) }));
                }
              }
            }
            if (msg.latitude != null) a.lat = msg.latitude;
            if (msg.longitude != null) a.lng = msg.longitude;
            if (msg.accuracyM != null) a.accuracyM = msg.accuracyM;
            if (msg.lastSeenAt) a.lastSeenAt = msg.lastSeenAt;
            if (msg.controlMode && msg.controlMode !== a.controlMode) {
              a.controlMode = msg.controlMode;
              updateModeUi(msg.controlMode);
            }

            if (msg.zone != null || msg.inFence != null) lastZoneAt = Date.now();
            applyUpdate(a, msg.zone, msg.inFence);
          }
        } catch {}
      });
    } catch {}

    // 2. Фоновый синхронизатор (каждые 5 сек) для обновления относительного времени и подстраховки SSE
    pollTimer = window.setInterval(async () => {
      if (!alive() || document.hidden) return;
      try {
        const fresh = await get<AnimalDto>(`/animals/${id}`);
        Object.assign(a, fresh);
        // keep the zone the stream gave a moment ago; fall back to the status only when the stream is silent
        if (Date.now() - lastZoneAt < 30000) applyUpdate(a);
        else applyUpdate(a, null, a.status !== 'danger');
      } catch {}
    }, 5000);

    // 3. Обработчики ручного управления ошейником (Оператор) с тактильным виброоткликом (Haptic Feedback)
    const triggerSignal = async (signal: 'SPEAKER' | 'BUZZER' | 'VIBRATION', btn: HTMLButtonElement) => {
      if (!a.collarId) return;
      if ('vibrate' in navigator) { try { navigator.vibrate([35]); } catch {} }
      const statusEl = $('#cmd-status', el);
      btn.disabled = true;
      if (statusEl) {
        statusEl.textContent = t('a.animal.cmdWait');
        statusEl.style.color = 'var(--ink-3)';
      }
      try {
        await post(`/devices/${encodeURIComponent(a.collarId)}/test-signal`, { signal });
        if ('vibrate' in navigator) { try { navigator.vibrate([20, 60, 20]); } catch {} }
        if (statusEl) {
          statusEl.textContent = t('a.animal.cmdSent');
          statusEl.style.color = 'var(--ok)';
        }
        setTimeout(() => {
          if (statusEl && statusEl.textContent === t('a.animal.cmdSent')) statusEl.textContent = '';
          btn.disabled = false;
        }, 3000);
      } catch (e) {
        btn.disabled = false;
        const err = errText(e);
        toast(err);
        if (statusEl) {
          statusEl.textContent = err;
          statusEl.style.color = 'var(--danger)';
        }
      }
    };

    const btnSpk = $<HTMLButtonElement>('#btn-spk', el);
    const btnBuz = $<HTMLButtonElement>('#btn-buz', el);
    const btnVib = $<HTMLButtonElement>('#btn-vib', el);

    if (btnSpk) btnSpk.addEventListener('click', () => void triggerSignal('SPEAKER', btnSpk));
    if (btnBuz) btnBuz.addEventListener('click', () => void triggerSignal('BUZZER', btnBuz));
    if (btnVib) btnVib.addEventListener('click', () => void triggerSignal('VIBRATION', btnVib));

    // 4. Переключатель 3 режимов: AUTO / GPS_MANUAL / MANUAL
    const tabAuto = $<HTMLButtonElement>('#mode-tab-auto', el);
    const tabGpsManual = $<HTMLButtonElement>('#mode-tab-gps-manual', el);
    const tabManual = $<HTMLButtonElement>('#mode-tab-manual', el);
    const contentAuto = $('#mode-content-auto', el);
    const contentGpsManual = $('#mode-content-gps-manual', el);
    const contentManual = $('#mode-content-manual', el);
    const ttlWrap = $('#mode-ttl-wrap', el);

    const updateModeUi = (m: CollarControlMode) => {
      ([[tabAuto, 'AUTO'], [tabGpsManual, 'GPS_MANUAL'], [tabManual, 'MANUAL']] as const).forEach(([b, v]) => {
        b?.setAttribute('aria-selected', String(m === v));
      });

      if (contentAuto) contentAuto.style.display = m === 'AUTO' ? 'block' : 'none';
      if (contentGpsManual) contentGpsManual.style.display = m === 'GPS_MANUAL' ? 'block' : 'none';
      if (contentManual) contentManual.style.display = m === 'MANUAL' ? 'block' : 'none';

      if (ttlWrap) {
        if (m !== 'AUTO' && a.controlModeExpiresAt) {
          setHtml(ttlWrap, html`<span class="mode-ttl-badge" title="${t('a.animal.modeTtlTitle')}">${raw(icon('clock', 14))} ${t('a.animal.modeAutoTtl', { time: formatTtl(a.controlModeExpiresAt) })}</span>`);
        } else {
          ttlWrap.innerHTML = '';
        }
      }
    };

    let modeBusy = false;
    const setMode = async (m: CollarControlMode) => {
      if (!a.collarId) {
        toast(t('a.animal.noCollarNotice'));
        return;
      }
      if (modeBusy || (m === 'GPS_MANUAL' && (a.controlMode ?? currentMode) === 'GPS_MANUAL')) return; // re-entering must not move the dragged point
      modeBusy = true;
      if ('vibrate' in navigator) { try { navigator.vibrate([18]); } catch {} }
      try {
        if (m === 'GPS_MANUAL') {
          // switch the mode and put the animal's point on the map (browser geolocation, else pen centre) so it can be dragged there
          const r = await enterGpsManual(a, { alive });
          if (r.skipped) return;
          updateModeUi('GPS_MANUAL');
          if (!r.placed && alive()) toast(t('a.animal.modeChanged', { mode: controlModeLabel(m) }));
          return;
        }
        const res = await collarControlApi.setMode(a.collarId, m);
        a.controlMode = m;
        a.controlModeExpiresAt = res.collar.controlModeExpiresAt ?? null;
        a.positionSource = res.collar.positionSource ?? 'GPS';
        updateModeUi(m);
        toast(t('a.animal.modeChanged', { mode: controlModeLabel(m) }));
      } catch (e) {
        toast(errText(e));
      } finally {
        modeBusy = false;
      }
    };

    tabAuto?.addEventListener('click', () => void setMode('AUTO'));
    tabGpsManual?.addEventListener('click', () => void setMode('GPS_MANUAL'));
    tabManual?.addEventListener('click', () => void setMode('MANUAL'));

    $('#edit')!.addEventListener('click', () => void openAnimalForm(ctx, a, () => void navigate(location.pathname, { replace: true })));
    $('#remove')!.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.animal.deleteTitle'), text: t('a.animal.deleteText', { name: a.name }), confirmLabel: t('a.animal.delete'), danger: true })) return;
      try { await del(`/animals/${a.id}`); void navigate('/app/herd', { replace: true }); } catch (e) { toast((e as Error).message); }
    });
    $('#unlink', el)?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.animal.unlinkTitle'), text: t('a.animal.unlinkText'), confirmLabel: t('a.animal.unlink'), danger: true })) return;
      try {
        await post(`/animals/${a.id}/unassign-collar`);
        toast(t('a.animal.unlinkedOk'));
        void navigate(location.pathname, { replace: true });
      } catch (e) {
        toast((e as Error).message);
      }
    });

    $$<HTMLElement>('[data-assign-collar]', el).forEach((btn) => btn.addEventListener('click', async () => {
      const devId = btn.dataset.assignCollar!;
      btn.setAttribute('disabled', 'true');
      try {
        await patch(`/devices/${encodeURIComponent(devId)}`, { animalId: a.id });
        toast(t('a.animal.assignedOk'));
        void navigate(location.pathname, { replace: true });
      } catch (err) {
        toast(errText(err));
        btn.removeAttribute('disabled');
      }
    }));
  }, { alive, backHref: '/app/herd', backLabel: t('a.animal.back') });

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    if (eventSource) eventSource.close();
    stop();
  };
};
