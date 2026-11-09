import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { icon } from '../../ui/icons';
import type { AppCtx } from '../app';
import { simApi, type AnimalDto, type PenDto, type SimEvent, type SimSpeed, type SimulationDto } from '../api';
import { confirmDialog, errText, SPECIES, speciesName, toast } from '../common';
import { collarResponseText, getSim, onSim, retryBusy, ringCentroid, setSim, stepPoint } from '../demo';

/** What the map view gives the panel. The panel never touches the map directly. */
export interface DemoHost {
  ctx: AppCtx;
  animals(): AnimalDto[];
  pens(): PenDto[];
  /** Re-fetch animals (and pens) and redraw map + list. */
  refresh(): Promise<void>;
  /** Next map click delivers [lng, lat]; `null` turns picking off. */
  setPick(handler: ((lng: number, lat: number) => void) | null): void;
  /** Every demo marker may be dragged (MANUAL, owner). */
  setDrag(on: boolean, onDrop: (id: string, lng: number, lat: number) => void): void;
  /** Click on the empty map while a demo animal is selected on the map: place it there (null turns it off). */
  setPlace(handler: ((id: string, lng: number, lat: number) => void) | null): void;
  select(id: string): void;
}

const EVENTS: SimEvent[] = ['BREACH', 'ESCAPE', 'RETURN', 'GPS_LOST', 'COLLAR_OFFLINE', 'COLLAR_ONLINE'];
const SPEEDS: SimSpeed[] = [1, 2, 5, 10];
const num = (v: string): number => Number(v.trim().replace(',', '.'));
const fmt = (n: number): string => n.toFixed(6);

/** Pilot-mode panel of the map: MANUAL (owner sets positions and events) and AUTO (server scenario). Owners only. */
export function mountDemoPanel(box: HTMLElement, host: DemoHost): { update(): void; dispose(): void; select(id: string): void } {
  const farm = host.ctx.farm.id;
  let selectedId: string | null = null;
  let lat = '';
  let lng = '';
  let result = '';
  let error = '';
  let picking = false;
  let busy = false;
  let countdown = 0;
  let herd = 8;
  let speed: SimSpeed = 1;
  let lastKey = '';
  let disposed = false;

  const demoAnimals = (): AnimalDto[] => host.animals().filter((a) => a.isDemo);
  const sim = (): SimulationDto | null => getSim();
  const mode = (): string => sim()?.dataMode ?? 'REAL';

  function stopPick(): void { picking = false; host.setPick(null); }

  function selectAnimal(id: string | null, fill = true): void {
    selectedId = id;
    const a = demoAnimals().find((x) => x.id === id);
    if (fill && a && a.lat != null && a.lng != null) { lat = fmt(a.lat); lng = fmt(a.lng); }
    armDrag();
  }

  function placeAt(id: string, x: number, y: number): void {
    if (selectedId !== id) { selectedId = id; }
    lat = fmt(y); lng = fmt(x);
    void send(y, x, id);
  }

  function armDrag(): void {
    const on = mode() === 'MANUAL' && host.ctx.isOwner;
    host.setDrag(on, placeAt);
    host.setPlace(on ? placeAt : null);
  }

  /** One click puts an animal that has no position yet into its pen (centre), from where it can be dragged. */
  function placeOffMap(id: string): void {
    const pen = penOf(id);
    if (!pen) { error = t('a.demo.noPen'); render(true); return; }
    const c = ringCentroid(pen);
    placeAt(id, c[0], c[1]);
    host.select(id);
  }

  async function guarded(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = errText(e); } finally { busy = false; }
    if (!disposed) { render(true); }
  }

  const refreshAll = async (): Promise<void> => { await host.refresh(); host.ctx.refreshChrome(); };

  async function send(la: number, lo: number, animalId?: string): Promise<void> {
    const id = animalId ?? selectedId;
    if (!id) return;
    await guarded(async () => {
      const r = await simApi.telemetry(farm, { animalId: id, lat: la, lng: lo });
      result = collarResponseText(r);
      await refreshAll();
    });
  }

  async function fire(ev: SimEvent): Promise<void> {
    if (!selectedId) return;
    const id = selectedId;
    await guarded(async () => {
      const r = await simApi.event(farm, { animalId: id, event: ev });
      result = 'zone' in r ? collarResponseText(r) : t('a.demo.r.ok');
      await refreshAll();
      const a = demoAnimals().find((x) => x.id === id);
      if (a && a.lat != null && a.lng != null) { lat = fmt(a.lat); lng = fmt(a.lng); }
    });
  }

  function currentPoint(): [number, number] | null {
    const a = demoAnimals().find((x) => x.id === selectedId);
    const la = num(lat), lo = num(lng);
    if (lat.trim() && lng.trim() && Number.isFinite(la) && Number.isFinite(lo)) return [lo, la];
    if (a && a.lat != null && a.lng != null) return [a.lng, a.lat];
    return null;
  }

  function penOf(id: string | null): PenDto | undefined {
    const a = demoAnimals().find((x) => x.id === id);
    const pens = host.pens();
    return pens.find((p) => p.id === a?.penId) ?? pens[0];
  }

  function step(dir: 'border' | 'out'): void {
    const pen = penOf(selectedId);
    if (!pen) { error = t('a.demo.noPen'); render(true); return; }
    const p = currentPoint() ?? ringCentroid(pen);
    const next = stepPoint(p, pen, dir);
    if (!next) return;
    lng = fmt(next[0]); lat = fmt(next[1]);
    void send(next[1], next[0]);
  }

  function fmtLeft(): string {
    const until = sim()?.until;
    if (!until) return '–';
    const s = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function manualHtml(): Safe {
    const list = demoAnimals();
    const off = list.filter((a) => a.lat == null || a.lng == null);
    return html`
      <p class="demo-hint">${t('a.demo.hint')}</p>
      ${off.length ? html`<fieldset class="demo-set"><legend>${t('a.demo.offMap')}</legend><ul class="off-list">${off.map((a) => html`<li><span>${a.name} · ${a.tag}</span><button type="button" class="btn btn-secondary btn-sm" data-place="${a.id}">${t('a.demo.placeOne')}</button></li>`)}</ul></fieldset>` : ''}
      <div class="field"><label for="d-an">${t('a.demo.animal')}</label>
        <select class="select" id="d-an">${list.length ? '' : html`<option value="">${t('a.demo.noAnimals')}</option>`}${list.map((a) => html`<option value="${a.id}" ${a.id === selectedId ? raw('selected') : ''}>${a.name} · ${a.tag}</option>`)}</select></div>
      <fieldset class="demo-set"><legend>${t('a.demo.pos')}</legend>
        <div class="demo-coords">
          <div class="field"><label for="d-lat">${t('a.demo.lat')}</label><input class="input num" id="d-lat" inputmode="decimal" autocomplete="off" value="${lat}"></div>
          <div class="field"><label for="d-lng">${t('a.demo.lng')}</label><input class="input num" id="d-lng" inputmode="decimal" autocomplete="off" value="${lng}"></div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-primary btn-sm" id="d-send" ${selectedId ? '' : raw('disabled')}>${t('a.demo.send')}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="d-pick" aria-pressed="${picking}" ${selectedId ? '' : raw('disabled')}>${raw(icon('crosshair-simple', 18))}${picking ? t('a.demo.pickOn') : t('a.demo.pick')}</button>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="d-border" ${selectedId ? '' : raw('disabled')}>${t('a.demo.stepBorder')}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="d-out" ${selectedId ? '' : raw('disabled')}>${t('a.demo.stepOut')}</button>
        </div>
        <p class="hint">${t('a.demo.drag')}</p>
      </fieldset>
      <fieldset class="demo-set"><legend>${t('a.demo.events')}</legend>
        <div class="demo-events">${EVENTS.map((e) => html`<button type="button" class="btn btn-secondary btn-sm" data-ev="${e}" ${selectedId ? '' : raw('disabled')}>${t(`a.demo.ev.${e}` as 'a.demo.ev.BREACH')}</button>`)}</div>
      </fieldset>
      <fieldset class="demo-set"><legend>${t('a.demo.addTitle')}</legend>
        <div class="field"><label for="d-name">${t('a.demo.addName')} <span class="opt">(${t('a.reg.optional')})</span></label><input class="input" id="d-name" maxlength="60" autocomplete="off"></div>
        <div class="field"><label for="d-sp">${t('a.demo.addSpecies')}</label><select class="select" id="d-sp">${SPECIES.map((s) => html`<option value="${s}">${speciesName(s)}</option>`)}</select></div>
        <button type="button" class="btn btn-secondary btn-sm" id="d-add" data-write>${raw(icon('plus', 18))}${t('a.demo.add')}</button>
      </fieldset>
      <div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" id="d-startsim" data-write>${t('a.demo.toAuto')}</button></div>`;
  }

  function autoHtml(): Safe {
    const s = sim()!;
    return html`
      <p class="demo-run"><strong>${s.running ? t('a.demo.running') : t('a.demo.stopped')}</strong>${s.running ? html` · <span>${t('a.demo.left')}: <span class="num" id="d-left">${fmtLeft()}</span></span>` : ''}</p>
      <div class="row-actions">
        ${s.running
          ? html`<button type="button" class="btn btn-secondary btn-sm" id="a-stop" data-write>${t('a.demo.stop')}</button>`
          : html`<button type="button" class="btn btn-primary btn-sm" id="a-start" data-write>${t('a.demo.start')}</button>`}
        <button type="button" class="btn btn-ghost btn-sm" id="a-reset" data-write>${t('a.demo.reset')}</button>
      </div>
      <div class="field"><span class="label" id="a-speed-l">${t('a.demo.speed')}</span>
        <div class="chips" role="group" aria-labelledby="a-speed-l">${SPEEDS.map((v) => html`<button type="button" class="chip-btn" data-speed="${v}" aria-pressed="${v === speed}" data-write>×${v}</button>`)}</div></div>
      <div class="field"><label for="a-herd">${t('a.demo.herd')}</label><input class="input num" id="a-herd" type="number" min="1" max="20" step="1" inputmode="numeric" value="${herd}" aria-describedby="a-herd-h"><p class="hint" id="a-herd-h">${t('a.demo.herdHint')}</p></div>
      <p class="hint">${t('a.demo.autoNote')}</p>`;
  }

  function render(keepFocus = false): void {
    if (disposed) return;
    const s = sim();
    const show = host.ctx.isOwner && !!s && s.dataMode !== 'REAL';
    box.hidden = !show;
    if (!show) { box.innerHTML = ''; stopPick(); host.setDrag(false, () => undefined); host.setPlace(null); lastKey = ''; return; }
    if (!selectedId || !demoAnimals().some((a) => a.id === selectedId)) selectAnimal(demoAnimals()[0]?.id ?? null);
    const prevFocus = keepFocus ? (document.activeElement as HTMLElement | null)?.id : '';
    const manual = s!.dataMode === 'MANUAL';
    setHtml(box, html`<section class="demo-panel" aria-labelledby="d-title">
      <h2 class="title-2 demo-title" id="d-title">${raw(icon('stack', 20))}${t('a.demo.panel')} <span class="demo-tag">${manual ? t('a.demo.m.MANUAL') : t('a.demo.m.AUTO')}</span></h2>
      ${manual ? manualHtml() : autoHtml()}
      <p class="field-error" role="alert" ${error ? '' : raw('hidden')}>${error}</p>
      <p class="demo-result" id="d-result" role="status" aria-live="polite">${result}</p>
    </section>`);
    bind(manual);
    if (prevFocus) $(`#${prevFocus}`, box)?.focus();
    window.clearInterval(countdown);
    if (!manual && s!.running) countdown = window.setInterval(() => { const n = $('#d-left', box); if (n) n.textContent = fmtLeft(); }, 1000);
    armDrag();
  }

  function bind(manual: boolean): void {
    if (manual) {
      $<HTMLSelectElement>('#d-an', box)?.addEventListener('change', (e) => { selectAnimal((e.target as HTMLSelectElement).value || null); render(true); if (selectedId) host.select(selectedId); });
      const read = (): [number, number] | null => {
        const la = num(lat), lo = num(lng);
        if (!lat.trim() || !lng.trim() || !Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
        return [la, lo];
      };
      $<HTMLInputElement>('#d-lat', box)?.addEventListener('input', (e) => { lat = (e.target as HTMLInputElement).value; });
      $<HTMLInputElement>('#d-lng', box)?.addEventListener('input', (e) => { lng = (e.target as HTMLInputElement).value; });
      $('#d-send', box)?.addEventListener('click', () => {
        const p = read();
        if (!p) { error = t('a.demo.coordsBad'); render(true); return; }
        void send(p[0], p[1]);
      });
      $('#d-pick', box)?.addEventListener('click', () => {
        if (picking) { stopPick(); render(true); return; }
        picking = true;
        host.setPick((x, y) => { lat = fmt(y); lng = fmt(x); stopPick(); void send(y, x); });
        render(true);
      });
      $('#d-border', box)?.addEventListener('click', () => step('border'));
      $('#d-out', box)?.addEventListener('click', () => step('out'));
      $$('[data-place]', box).forEach((b) => b.addEventListener('click', () => placeOffMap(b.dataset.place!)));
      $$('[data-ev]', box).forEach((b) => b.addEventListener('click', () => void fire(b.dataset.ev as SimEvent)));
      $('#d-add', box)?.addEventListener('click', () => void guarded(async () => {
        const name = $<HTMLInputElement>('#d-name', box)!.value.trim();
        const species = $<HTMLSelectElement>('#d-sp', box)!.value as AnimalDto['species'];
        const a = await simApi.addAnimal(farm, { ...(name ? { name } : {}), species });
        result = t('a.demo.added', { name: a.name });
        await refreshAll();
        selectAnimal(a.id);
        host.select(a.id);
      }));
      $('#d-startsim', box)?.addEventListener('click', () => void guarded(async () => { setSim(await retryBusy(() => simApi.start(farm, { speed, herd }), () => toast(t('a.demo.retrying'))), farm); await refreshAll(); }));
      return;
    }
    const herdInput = $<HTMLInputElement>('#a-herd', box);
    herdInput?.addEventListener('input', () => { const v = Number(herdInput.value); if (Number.isInteger(v) && v >= 1 && v <= 20) herd = v; });
    $('#a-start', box)?.addEventListener('click', () => {
      const v = Number(herdInput?.value);
      if (!Number.isInteger(v) || v < 1 || v > 20) { error = t('a.demo.herdBad'); render(true); return; }
      herd = v;
      void guarded(async () => { setSim(await retryBusy(() => simApi.start(farm, { speed, herd }), () => toast(t('a.demo.retrying'))), farm); await refreshAll(); });
    });
    $('#a-stop', box)?.addEventListener('click', () => void guarded(async () => { setSim(await retryBusy(() => simApi.stop(farm), () => toast(t('a.demo.retrying'))), farm); await refreshAll(); }));
    $('#a-reset', box)?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.demo.resetTitle'), text: t('a.demo.resetText'), confirmLabel: t('a.demo.reset') })) return;
      void guarded(async () => { setSim(await simApi.reset(farm), farm); result = t('a.demo.resetDone'); await refreshAll(); });
    });
    $$('[data-speed]', box).forEach((b) => b.addEventListener('click', () => {
      speed = Number(b.dataset.speed) as SimSpeed;
      if (sim()?.running) void guarded(async () => { setSim(await simApi.setSpeed(farm, speed), farm); });
      else render(true);
    }));
  }

  // keep local controls in step with the server state; re-render only when the mode or the animals changed
  const stopSim = onSim((s) => {
    if (s) { speed = (SPEEDS.includes(s.speed as SimSpeed) ? s.speed : 1) as SimSpeed; if (s.dataMode === 'AUTO') herd = s.herd; }
    const key = `${s?.dataMode}|${s?.running}|${s?.speed}`;
    if (key === lastKey) return;
    lastKey = key;
    if (s?.dataMode !== 'MANUAL') stopPick();
    render(true);
  });

  render();

  return {
    /** Called by the host after it re-fetched animals: redraws without stealing focus from a field being edited. */
    update(): void { if (!box.hidden && !box.contains(document.activeElement)) render(); },
    dispose(): void {
      disposed = true;
      window.clearInterval(countdown);
      stopSim();
      stopPick();
      host.setDrag(false, () => undefined);
      host.setPlace(null);
    },
    /** The map selected an animal: follow it in the panel. */
    select(id: string): void {
      if (id === selectedId || !demoAnimals().some((a) => a.id === id)) return;
      selectAnimal(id);
      if (!box.hidden && !box.contains(document.activeElement)) render();
    },
  };
}
