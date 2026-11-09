import { $, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { navigate } from '../../router';
import type { AppCtx, AppView } from '../app';
import { ApiError, del, get, patch, post, type AlertDto, type AnimalDto, type CollarDto, type EventsDto, type PenDto } from '../api';
import { animalBadge, confirmDialog, errText, loadInto, offlineGuard, pulseThreatBadge, SPECIES, speciesName, timeEl, toast } from '../common';
import { formModal } from '../forms';
import { icon } from '../../ui/icons';

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
      <div class="field"><label for="af-sp">${t('a.animal.f.species')}</label><select class="select" id="af-sp" name="species">${SPECIES.map((s) => html`<option value="${s}" ${animal?.species === s ? raw('selected') : ''}>${speciesName(s)}</option>`)}</select></div>
      <div class="field"><label for="af-pen">${t('a.animal.f.pen')}</label><select class="select" id="af-pen" name="penId"><option value="">${t('a.animal.f.none')}</option>${pens.map((p) => html`<option value="${p.id}" ${animal?.penId === p.id ? raw('selected') : ''}>${p.name}</option>`)}</select></div>
      <div class="field"><label for="af-col">${t('a.animal.f.collar')}</label><select class="select" id="af-col" name="collarId"><option value="">${t('a.animal.f.none')}</option>${free.map((c) => html`<option value="${c.deviceId}" ${animal?.collarId === c.deviceId ? raw('selected') : ''}>${c.deviceId}</option>`)}</select></div>`,
    async onSubmit(form) {
      const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
      if (!v('name') || !v('tag')) return t('a.err.required');
      try {
        if (!animal) {
          const body: Record<string, string> = { name: v('name'), tag: v('tag'), species: v('species') };
          if (v('penId')) body.penId = v('penId');
          if (v('collarId')) body.collarId = v('collarId');
          await post<AnimalDto>('/animals', body);
        } else {
          const body: Record<string, string | null> = {};
          if (v('name') !== animal.name) body.name = v('name');
          if (v('tag') !== animal.tag) body.tag = v('tag');
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

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.animal.title'));
  ctx.setActions('');
  const stop = offlineGuard(document.body);
  const id = ctx.params.id;
  const alive = () => el.isConnected;
  let pollTimer: number | null = null;
  let eventSource: EventSource | null = null;

  const pulseInfo = (hr: number | null | undefined, at: string | null | undefined) => {
    const isLive = at ? Date.now() - new Date(at).getTime() < 15000 : false;
    const val = hr != null ? t('a.animal.bpm', { n: hr }) : '—';
    const sub = at
      ? html`${timeEl(at)} ${isLive ? html`<span class="badge badge-online"><span class="dot"></span> ${t('a.animal.livePulse')}</span>` : html`<span class="muted">(${t('a.animal.noFinger')})</span>`}`
      : html`${t('a.animal.noPulse')}`;
    return { val, sub, isLive };
  };

  const threatDetails = (a: AnimalDto): Safe => {
    const pt = a.pulseThreat;
    if (!pt || pt.level === 'UNKNOWN') return html`<span class="caption muted">Норма вида (${speciesName(a.species)}): ${pt?.normalMin ?? '—'}–${pt?.normalMax ?? '—'} уд/мин</span>`;
    const sign = pt.deltaPercent > 0 ? '+' : '';
    return html`<span class="caption muted">Норма: <strong class="num">${pt.normalMin}–${pt.normalMax}</strong> уд/мин · База: <strong class="num">${pt.baseline}</strong> (${sign}${pt.deltaPercent}%)</span>`;
  };

  const zoneBadge = (zone?: string | null, inFence?: boolean | null): Safe => {
    if (zone === 'GREEN' || (inFence && !zone)) {
      return html`<span class="badge badge-online"><span class="dot"></span> ${t('a.animal.zoneSafe')}</span>`;
    }
    if (zone === 'YELLOW') {
      return html`<span class="badge badge-warn"><span class="dot"></span> ${t('a.animal.zoneWarn')}</span>`;
    }
    if (zone === 'ORANGE') {
      return html`<span class="badge badge-warn" style="color:var(--warn-dark,#d97706);"><span class="dot"></span> ${t('a.animal.zoneCrit')}</span>`;
    }
    if (zone === 'RED' || inFence === false) {
      return html`<span class="badge badge-danger"><span class="dot"></span> ${t('a.animal.zoneBreach')}</span>`;
    }
    if (zone === 'ESCAPE') {
      return html`<span class="badge" style="background:var(--surface-3);color:var(--text-muted);"><span class="dot"></span> ${t('a.animal.zoneEscape')}</span>`;
    }
    return html`<span class="caption muted">${t('a.st.ok')}</span>`;
  };

  void loadInto(el, async () => {
    const [animal, ev, pens] = await Promise.all([
      get<AnimalDto>(`/animals/${id}`),
      get<EventsDto>(`/animals/${id}/events`).catch(() => null),
      get<PenDto[]>('/geofences').catch(() => [] as PenDto[]),
    ]);
    return { animal, ev, pens };
  }, ({ animal: a, ev, pens }) => {
    ctx.setTitle(`${a.name} · ${a.tag}`);
    ctx.setActions(html`<button type="button" class="btn btn-secondary btn-sm" id="edit" data-write>${t('a.animal.edit')}</button><button type="button" class="btn btn-danger btn-sm" id="remove" data-write>${t('a.animal.delete')}</button>`);
    const pen = pens.find((p) => p.id === a.penId);
    const sig = ev?.signals;
    const lim = (l: number | null) => (l == null ? t('a.animal.noLimit') : t('a.animal.limit', { n: l }));
    const pi = pulseInfo(a.lastHeartRate, a.lastHeartRateAt);

    setHtml(el, html`
      <p><a href="/app/herd">${t('a.animal.back')}</a></p>
      <div class="profile-head">
        <div id="badge-wrap">${animalBadge(a)}</div>
        <div class="row-actions">
          <span class="badge badge-online" id="stream-indicator" title="Server-Sent Events active"><span class="dot"></span> ${t('a.animal.streamLive')}</span>
          <a class="btn btn-primary btn-sm" href="/app/map?animal=${a.id}">${t('a.map.showOnMap')}</a>
        </div>
      </div>

      <div class="grid-2">
        <!-- 1. Мониторинг здоровья и пульса (Live) -->
        <section class="panel-block" aria-labelledby="h-pulse">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h2 class="title-2" id="h-pulse" style="display:flex;align-items:center;gap:0.4rem;">${raw(icon('heartbeat', 20))} ${t('a.animal.pulse')}</h2>
            <div id="pulse-threat-wrap">${pulseThreatBadge(a.pulseThreat)}</div>
          </div>
          <p class="num font-mono" id="pulse-val" style="font-size:2.4rem;font-weight:700;letter-spacing:-0.03em;margin:0.25rem 0;">${pi.val}</p>
          <p class="muted" id="pulse-sub">${pi.sub}</p>
          <div id="pulse-details">${threatDetails(a)}</div>
        </section>

        <!-- 2. Автоматический контроль (Геозона · модель Halter) -->
        <section class="panel-block" aria-labelledby="h-auto">
          <h2 class="title-2" id="h-auto" style="display:flex;align-items:center;gap:0.4rem;">${raw(icon('map-trifold', 20))} ${t('a.animal.autoControl')}</h2>
          <p class="caption muted">${t('a.animal.autoDesc')}</p>
          <div style="margin:0.6rem 0;" id="zone-wrap">${zoneBadge(null, a.status !== 'danger')}</div>
          <p style="margin-bottom:0.4rem;"><strong>${t('a.animal.pen')}:</strong> ${pen ? html`<a href="/app/map?pen=${pen.id}">${pen.name}</a>` : t('a.herd.noPen')}</p>
          <div id="sig-limits" class="caption muted" style="padding-top:0.4rem;border-top:1px solid var(--border-subtle,#333);">
            ${sig ? html`<span>${t('a.animal.sound')}: <strong class="num">${sig.sound.used}</strong> (${lim(sig.sound.limit)}) · ${t('a.animal.vibration')}: <strong class="num">${sig.vibration.used}</strong> (${lim(sig.vibration.limit)})</span>` : html`<span>${t('a.animal.signals')}: —</span>`}
          </div>
        </section>

        <!-- 3. Ручное управление ошейником (Оператор) -->
        <section class="panel-block" aria-labelledby="h-manual">
          <h2 class="title-2" id="h-manual" style="display:flex;align-items:center;gap:0.4rem;">${raw(icon('gear-six', 20))} ${t('a.animal.manualControl')}</h2>
          <p class="caption muted">${t('a.animal.manualDesc')}</p>
          <div class="row-actions" style="margin-top:0.75rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-spk" ${!a.collarId ? raw('disabled') : ''} data-write style="display:flex;align-items:center;gap:0.35rem;">${raw(icon('speaker-high', 16))} ${t('a.animal.spkBtn')}</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-buz" ${!a.collarId ? raw('disabled') : ''} data-write style="display:flex;align-items:center;gap:0.35rem;">${raw(icon('bell-ringing', 16))} ${t('a.animal.buzBtn')}</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-vib" ${!a.collarId ? raw('disabled') : ''} data-write style="display:flex;align-items:center;gap:0.35rem;">${raw(icon('vibrate', 16))} ${t('a.animal.vibBtn')}</button>
          </div>
          <p class="caption muted" id="cmd-status" role="status" style="margin-top:0.5rem;min-height:1.2rem;"></p>
        </section>

        <!-- 4. Положение и привязка ошейника (GPS & Device) -->
        <section class="panel-block" aria-labelledby="h-pos">
          <h2 class="title-2" id="h-pos" style="display:flex;align-items:center;gap:0.4rem;">${raw(icon('crosshair-simple', 20))} ${t('a.animal.position')}</h2>
          <p class="num" id="pos-val">${a.lat != null && a.lng != null ? t('a.animal.coords', { lat: a.lat.toFixed(5), lng: a.lng.toFixed(5) }) : '—'}</p>
          <p class="muted" id="pos-sub">${t('a.animal.accuracy')}: ${a.accuracyM != null ? `${Math.round(a.accuracyM)} m` : '—'} · ${timeEl(a.lastSeenAt)}</p>
          <div style="margin-top:0.6rem;padding-top:0.4rem;border-top:1px solid var(--border-subtle,#333);display:flex;justify-content:space-between;align-items:center;">
            <span id="col-val"><strong>${t('a.animal.collar')}:</strong> ${a.collarId ? html`<a href="/app/collars/${a.collarId}">${a.collarId}</a>` : t('a.herd.noCollar')}</span>
            ${a.collarId ? html`<button type="button" class="btn btn-secondary btn-sm" id="unlink" data-write>${t('a.animal.unlink')}</button>` : ''}
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
        pVal.style.color = pFresh.isLive ? 'var(--ok, #16a34a)' : 'inherit';
        setTimeout(() => { if (pVal) pVal.style.color = 'inherit'; }, 400);
      }
      if (pSub) setHtml(pSub, pFresh.sub);
      if (pThreat && fresh.pulseThreat) setHtml(pThreat, pulseThreatBadge(fresh.pulseThreat));
      if (pDet && fresh.species) setHtml(pDet, threatDetails(fresh as AnimalDto));
      if (bWrap) setHtml(bWrap, animalBadge(fresh as AnimalDto));

      if (posVal) posVal.textContent = fresh.lat != null && fresh.lng != null ? t('a.animal.coords', { lat: fresh.lat.toFixed(5), lng: fresh.lng.toFixed(5) }) : '—';
      if (posSub) setHtml(posSub, html`${t('a.animal.accuracy')}: ${fresh.accuracyM != null ? `${Math.round(fresh.accuracyM)} m` : '—'} · ${timeEl(fresh.lastSeenAt)}`);
      if (zWrap && (zone !== undefined || inFence !== undefined)) {
        setHtml(zWrap, zoneBadge(zone, inFence));
      }
    };

    // 1. Потоковое обновление через Server-Sent Events (SSE) в реальном времени (0 ms задержки)
    try {
      eventSource = new EventSource(`/api/v1/device/stream?animalId=${encodeURIComponent(id)}`);
      eventSource.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'telemetry') {
            if (msg.heartRate != null) {
              a.lastHeartRate = msg.heartRate;
              a.lastHeartRateAt = msg.lastHeartRateAt || msg.serverTime;
            }
            if (msg.pulseThreat) a.pulseThreat = msg.pulseThreat;
            if (msg.latitude != null) a.lat = msg.latitude;
            if (msg.longitude != null) a.lng = msg.longitude;
            if (msg.accuracyM != null) a.accuracyM = msg.accuracyM;
            if (msg.lastSeenAt) a.lastSeenAt = msg.lastSeenAt;

            applyUpdate(a, msg.zone, msg.inFence);
          }
        } catch {}
      };
      eventSource.onerror = () => {
        // SSE переподключится автоматически; фоновый опрос подстрахует
      };
    } catch {}

    // 2. Фоновый синхронизатор (каждую 1 сек) для обновления относительного времени и подстраховки SSE
    pollTimer = window.setInterval(async () => {
      if (!alive() || document.hidden) return;
      try {
        const fresh = await get<AnimalDto>(`/animals/${id}`);
        Object.assign(a, fresh);
        applyUpdate(a, null, a.status !== 'danger');
      } catch {}
    }, 1000);

    // 3. Обработчики ручного управления ошейником (Оператор) с тактильным виброоткликом (Haptic Feedback)
    const triggerSignal = async (signal: 'SPEAKER' | 'BUZZER' | 'VIBRATION', btn: HTMLButtonElement) => {
      if (!a.collarId) return;
      if ('vibrate' in navigator) { try { navigator.vibrate([35]); } catch {} }
      const statusEl = $('#cmd-status', el);
      btn.disabled = true;
      if (statusEl) {
        statusEl.textContent = t('a.animal.cmdWait');
        statusEl.style.color = 'var(--text-muted)';
      }
      try {
        await post(`/devices/${encodeURIComponent(a.collarId)}/test-signal`, { signal });
        if ('vibrate' in navigator) { try { navigator.vibrate([20, 60, 20]); } catch {} }
        if (statusEl) {
          statusEl.textContent = t('a.animal.cmdSent');
          statusEl.style.color = 'var(--ok, #16a34a)';
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
          statusEl.style.color = 'var(--danger, #dc2626)';
        }
      }
    };

    const btnSpk = $<HTMLButtonElement>('#btn-spk', el);
    const btnBuz = $<HTMLButtonElement>('#btn-buz', el);
    const btnVib = $<HTMLButtonElement>('#btn-vib', el);

    if (btnSpk) btnSpk.addEventListener('click', () => void triggerSignal('SPEAKER', btnSpk));
    if (btnBuz) btnBuz.addEventListener('click', () => void triggerSignal('BUZZER', btnBuz));
    if (btnVib) btnVib.addEventListener('click', () => void triggerSignal('VIBRATION', btnVib));

    $('#edit')!.addEventListener('click', () => void openAnimalForm(ctx, a, () => void navigate(location.pathname, { replace: true })));
    $('#remove')!.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.animal.deleteTitle'), text: t('a.animal.deleteText', { name: a.name }), confirmLabel: t('a.animal.delete'), danger: true })) return;
      try { await del(`/animals/${a.id}`); void navigate('/app/herd', { replace: true }); } catch (e) { toast((e as Error).message); }
    });
    $('#unlink', el)?.addEventListener('click', async () => {
      try { await post(`/animals/${a.id}/unassign-collar`); void navigate(location.pathname, { replace: true }); } catch (e) { toast((e as Error).message); }
    });
  }, { alive });

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    if (eventSource) eventSource.close();
    stop();
  };
};
