import { $, $$, esc, html, raw, setHtml, type Safe } from '../../dom';
import { getLang, t } from '../../i18n';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { collarControlApi, del, get, post, request, type AnimalDto, type PenDto, type PulseThreatDto } from '../api';
import { demoTag } from '../demo';
import { absTime, animalBadge, confirmDialog, controlModeLabel, emptyState, errorState, errText, offlineGuard, pulseThreatBadge, skeleton, speciesName, timeAgo, toast } from '../common';
import { formModal } from '../forms';
import { openAnimalForm } from './animal';
import { getSim, onSim } from '../demo';
import { mountDemoPanel } from './demo-panel';
import { enterGpsManual } from '../manual-place';
import { openStream, type StreamHandle } from '../stream';

// MapLibre is loaded lazily, only on this route (site-brief 8). Base map: OpenFreeMap (no key), OSM attribution from the style.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const CLUSTER_MIN = 30;
const cssVar = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

type MLMap = import('maplibre-gl').Map;

async function fetchAll(): Promise<AnimalDto[]> {
  // server max page size is 100 (server/src/common/pagination.ts PAGE_MAX_LIMIT): one request for a normal herd
  const byId = new Map<string, AnimalDto>();
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r: { data: AnimalDto[]; next: string | null } = await request<AnimalDto[]>('GET', `/animals?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const a of r.data) byId.set(a.id, a);
    cursor = r.next;
    if (!cursor) break;
  }
  return [...byId.values()];
}

const centroid = (p: PenDto): [number, number] => {
  const ring = p.polygon.coordinates[0] ?? [];
  const pts = ring.slice(0, -1);
  const n = Math.max(1, pts.length);
  return [pts.reduce((s, c) => s + c[0], 0) / n, pts.reduce((s, c) => s + c[1], 0) / n];
};

export const mount: AppView['mount'] = async (el, ctx) => {
  ctx.setTitle(t('a.map.title'));
  ctx.setActions('');
  el.classList.add('map-page');
  const stopGuard = offlineGuard(document.body);
  let animals: AnimalDto[] = [];
  let pens: PenDto[] = [];
  let updatedAt = Date.now();
  let dataReady = false;

  let selected: string | null = ctx.query.get('animal');
  let query = '';
  let map: MLMap | null = null;
  let mapReady = false;
  let markers: import('maplibre-gl').Marker[] = [];
  let penMarkers: import('maplibre-gl').Marker[] = [];
  let ML: typeof import('maplibre-gl') | null = null;
  let me: import('maplibre-gl').Marker | null = null;
  let disposed = false;
  const timers: number[] = [];
  let pickHandler: ((lng: number, lat: number) => void) | null = null;
  let demoRef: { select(id: string): void } | null = null;
  let dragOn = false;
  let dragDrop: (id: string, lng: number, lat: number) => void = () => undefined;
  let placeHandler: ((id: string, lng: number, lat: number) => void) | null = null;
  let dragging = false;
  // animals whose dragged point is being saved: stale poll/stream data must not move them back
  const pendingDrag = new Set<string>();

  // Режим рисования загона на карте
  let drawing = false;
  let drawPoints: [number, number][] = [];
  let drawMarkers: import('maplibre-gl').Marker[] = [];

  setHtml(el, html`
    <div class="map-wrap">
      <div class="map-area">
        <div class="map" id="map" role="region" aria-label="${t('a.map.container')}"></div>
        <p class="map-hint" id="map-hint" hidden>${t('a.demo.hint')}</p>
        <p class="map-notice glass-light" id="map-notice" role="status" hidden>${t('a.map.mapFail')}</p>

        <!-- Верхняя плашка рисования загона -->
        <div class="draw-bar" id="draw-bar" role="toolbar" style="display:none;">
          <div class="draw-bar-top">
            <div class="draw-bar-top-left">
              <span class="draw-badge-icon">${raw(icon('pencil-simple', 18))}</span>
              <div class="draw-info">
                <span class="draw-title">${t('a.map.drawTitle')}</span>
                <span class="draw-count" id="draw-count">${t('a.map.drawPoints', { n: 0 })}</span>
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm draw-btn-cancel-mobile" id="draw-cancel-mobile" aria-label="${t('a.map.drawCancel')}">${raw(icon('x', 18))}</button>
          </div>
          <div class="draw-divider"></div>
          <div class="draw-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="draw-undo" disabled>
              ${raw(icon('arrow-u-up-left', 16))} <span>${t('a.map.drawUndo')}</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="draw-finish" disabled>
              ${raw(icon('check', 16))} <span>${t('a.map.drawFinish')}</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm draw-btn-cancel" id="draw-cancel" title="${t('a.map.drawCancel')}">
              ${raw(icon('x', 18))} <span>${t('a.map.drawCancel')}</span>
            </button>
          </div>
        </div>

        <div class="map-controls">
          <button type="button" class="map-btn glass-light" id="m-in" aria-label="${t('a.map.zoomIn')}">${raw(icon('plus', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-out" aria-label="${t('a.map.zoomOut')}">${raw(icon('minus', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-fit" aria-label="${t('a.map.fitAll')}">${raw(icon('corners-out', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-loc" aria-label="${t('a.map.locate')}">${raw(icon('crosshair-simple', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-draw" aria-label="${t('a.map.draw')}" title="${t('a.map.draw')}">${raw(icon('pencil-simple', 22))}</button>
        </div>
      </div>
      <aside class="map-panel glass-light" id="panel" data-sheet="peek" aria-label="${t('a.map.sheet')}">
        <button type="button" class="sheet-handle" id="sheet-toggle" aria-label="${t('a.map.expand')}"><span aria-hidden="true"></span></button>
        <div class="panel-scroll"><div id="demo-box" class="demo-box" hidden></div><div class="panel-inner" id="panel-body">${skeleton(3)}</div></div>
      </aside>
    </div>`);

  const panelBody = $('#panel-body', el)!;
  const statusClass = (a: AnimalDto) => (a.status === 'danger' ? 'out' : a.status === 'offline' ? 'off' : a.status === 'warning' ? 'warn' : 'ok');

  function visible(): AnimalDto[] {
    const s = query.trim().toLowerCase();
    return s ? animals.filter((a) => a.name.toLowerCase().includes(s) || a.tag.toLowerCase().includes(s)) : animals;
  }

  function drawPanel(): void {
    const sel = animals.find((a) => a.id === selected);
    if (sel) {
      const isManualGps = sel.controlMode === 'GPS_MANUAL' || sel.positionSource === 'MANUAL';
      panelBody.innerHTML = html`
        <button type="button" class="btn btn-ghost btn-sm" id="back">${t('a.map.back')}</button>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
          <h2 class="title-2" style="margin:0;">${sel.name} · ${sel.tag}</h2>
          ${isManualGps
            ? html`<span class="badge badge-warning" title="${t('a.map.dragHintManual')}">${t('a.map.posSourceManual')}</span>`
            : html`<span class="badge badge-sm">${t('a.map.posSourceGps')}</span>`}
        </div>
        <p style="margin:0.25rem 0;">${animalBadge(sel)}</p>
        <p class="muted">${speciesName(sel.species)} · ${sel.penId ? pens.find((p) => p.id === sel.penId)?.name ?? '' : t('a.map.noPen')}</p>
        <p>${sel.lastHeartRate != null ? html`${pulseThreatBadge(sel.pulseThreat)} <span class="num">${t('a.animal.bpm', { n: sel.lastHeartRate })}</span> · ` : ''}<span class="muted">${sel.lat == null ? t('a.map.noPos') : `${timeAgo(sel.lastSeenAt)}`}</span></p>
        ${sel.pulseThreat?.sourceNoteRu ? html`<p class="caption muted pulse-source-note-box">${sel.pulseThreat.sourceNoteRu}</p>` : ''}
        ${isManualGps ? html`<p class="caption manual-gps-note">${t('a.map.dragHintManual')}</p>` : ''}
        <div class="row-actions" style="margin-top:0.75rem;flex-wrap:wrap;gap:0.5rem;">
          <a class="btn btn-primary btn-sm" href="/app/herd/${sel.id}">${t('a.map.openProfile')}</a>
          ${sel.collarId ? html`
            <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-ctrl-mode" style="display:inline-flex;align-items:center;gap:0.35rem;">
              ${isManualGps ? raw(icon('map-trifold', 16) + ' ' + esc(t('a.map.ctrlAuto'))) : raw(icon('crosshair-simple', 16) + ' ' + esc(t('a.map.ctrlGpsManual')))}
            </button>` : ''}
        </div>`.s;
      $('#back', panelBody)!.addEventListener('click', () => { selected = null; drawPanel(); renderMarkers(); });
      $('#btn-toggle-ctrl-mode', panelBody)?.addEventListener('click', async () => {
        if (!sel.collarId) return;
        const btn = $<HTMLButtonElement>('#btn-toggle-ctrl-mode', panelBody);
        if (btn) btn.disabled = true;
        try {
          if (isManualGps) {
            const res = await collarControlApi.setMode(sel.collarId, 'AUTO');
            sel.controlMode = 'AUTO';
            sel.controlModeExpiresAt = res.collar.controlModeExpiresAt ?? null;
            sel.positionSource = 'GPS';
            toast(t('a.animal.modeChanged', { mode: controlModeLabel('AUTO') }));
          } else {
            const r = await enterGpsManual(sel, {
              alive: () => !disposed,
              pens,
              mapCenter: () => { const c = map?.getCenter(); return c ? [c.lng, c.lat] : null; },
            });
            if (!r.placed && !r.skipped && !disposed) toast(t('a.animal.modeChanged', { mode: controlModeLabel('GPS_MANUAL') }));
            if (r.placed && map && r.lng != null && r.lat != null) map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 15), essential: false });
          }
          drawPanel();
          renderMarkers();
        } catch (e) {
          toast(errText(e));
          if (btn) btn.disabled = false;
        }
      });
      return;
    }
    const out = animals.filter((a) => a.status === 'danger').length;
    const off = animals.filter((a) => a.status === 'offline').length;
    const list = visible();
    const tiles: Safe = html`<div class="tiles" role="group" aria-label="${t('a.map.sum')}"><div class="tile ${out ? 'tile-out' : ''}"><strong class="num">${out}</strong><span>${t('a.map.out')}</span></div><div class="tile"><strong class="num">${off}</strong><span>${t('a.map.noConn')}</span></div><div class="tile"><strong class="num">${animals.length}</strong><span>${t('a.map.total')}</span></div></div>`;
    panelBody.innerHTML = html`
      <h2 class="title-2 panel-title">${t('a.map.sum')}</h2>
      ${tiles}
      <p class="caption muted" title="${absTime(new Date(updatedAt).toISOString())}">${t('a.state.updated', { time: timeAgo(new Date(updatedAt).toISOString()) })}</p>
      ${animals.length ? html`<div class="search"><label class="sr-only" for="mq">${t('a.map.search')}</label>${raw(icon('magnifying-glass', 20, 'search-ico'))}<input class="input" id="mq" type="search" placeholder="${t('a.map.search')}" value="${query}" autocomplete="off"></div>
        <ul class="plist" aria-label="${t('a.map.list')}">${list.map((a) => html`<li><button type="button" class="prow ${a.id === selected ? 'sel' : ''}" data-id="${a.id}"><span class="mk ${statusClass(a)}${a.isDemo ? ' demo' : ''}" aria-hidden="true"></span><span class="prow-main"><strong>${a.name}${demoTag(a.isDemo)}</strong><span class="caption muted">${a.tag}${a.lat == null ? ` · ${t('a.map.noPos')}` : ''}</span></span><span class="prow-side">${animalBadge(a)}</span></button></li>`)}</ul>`
        : emptyState(t('a.map.empty'), undefined, html`<button type="button" class="btn btn-primary btn-sm" id="p-add" data-write>${t('a.herd.add')}</button>`)}
      ${pens.length
        ? html`
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1.25rem;margin-bottom:0.5rem;">
            <h3 class="title-3" style="margin:0;">${t('a.map.pens')} (${pens.length})</h3>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-draw-inline" style="display:inline-flex;align-items:center;gap:0.3rem;">
              ${raw(icon('pencil-simple', 16))} ${t('a.map.draw')}
            </button>
          </div>
          <ul class="pen-list" style="margin:0;padding:0;list-style:none;">
            ${pens.map((p) => html`
              <li style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0.2rem;border-bottom:1px solid var(--line-soft);gap:0.5rem;">
                <span class="row-link" data-fit-pen="${p.id}" style="cursor:pointer;flex:1;display:flex;align-items:center;gap:0.4rem;overflow:hidden;text-overflow:ellipsis;" title="${p.name}">
                  <span class="dot" style="background:${p.color || 'var(--primary)'};display:inline-block;width:10px;height:10px;border-radius:50%;flex-shrink:0;"></span>
                  <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</strong>
                  <span class="caption muted" style="white-space:nowrap;">· ${t('a.map.penCount', { n: p.animalsCount })}${p.areaHa ? ` · ${t('a.map.penArea', { n: p.areaHa.toFixed(1) })}` : ''}</span>
                </span>
                ${!p.isDemo ? html`
                  <button type="button" class="btn btn-ghost btn-sm" data-delete-pen="${p.id}" data-name="${p.name}" title="${t('a.map.penDeleteTitle')}" aria-label="${t('a.map.penDeleteTitle')}" style="padding:4px 6px;color:var(--danger);flex-shrink:0;">
                    ${raw(icon('trash', 16))}
                  </button>
                ` : ''}
              </li>
            `)}
          </ul>
        `
        : html`
          <div style="margin-top:1.25rem;">
            <p class="muted">${t('a.map.noPens')}</p>
            <button type="button" class="btn btn-primary btn-sm" id="btn-draw-inline" style="margin-top:0.5rem;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;">
              ${raw(icon('pencil-simple', 18))} ${t('a.map.draw')}
            </button>
          </div>
        `}`.s;
    $<HTMLInputElement>('#mq', panelBody)?.addEventListener('input', (e) => {
      query = (e.target as HTMLInputElement).value;
      const pos = (e.target as HTMLInputElement).selectionStart;
      drawPanel();
      const n = $<HTMLInputElement>('#mq', panelBody)!; n.focus(); if (pos != null) n.setSelectionRange(pos, pos);
    });
    $$('.prow', panelBody).forEach((b) => b.addEventListener('click', () => select(b.dataset.id!, true)));
    $('#p-add', panelBody)?.addEventListener('click', () => void openAnimalForm(ctx, undefined, async () => {
      try {
        animals = await fetchAll();
        drawPanel();
        renderMarkers();
        ctx.refreshChrome();
      } catch {}
    }));
    $('#btn-draw-inline', panelBody)?.addEventListener('click', () => {
      startDrawing();
    });
    $$('[data-fit-pen]', panelBody).forEach((sp) => sp.addEventListener('click', () => {
      const pid = (sp as HTMLElement).dataset.fitPen!;
      const p = pens.find((x) => x.id === pid);
      if (!p || !map || !ML) return;
      const b = new ML.LngLatBounds();
      p.polygon.coordinates[0]?.forEach((c) => b.extend([c[0], c[1]]));
      map.fitBounds(b, { padding: 80, maxZoom: 16, duration: 600 });
    }));
    $$('[data-delete-pen]', panelBody).forEach((btn) => btn.addEventListener('click', async () => {
      const pid = (btn as HTMLElement).dataset.deletePen!;
      const pname = (btn as HTMLElement).dataset.name!;
      if (!await confirmDialog({
        title: t('a.map.penTitle'),
        text: t('a.map.penDeleteConfirm', { name: pname }),
        confirmLabel: t('a.animal.delete'),
        danger: true,
      })) return;
      try {
        await del(`/geofences/${pid}`);
        pens = pens.filter((x) => x.id !== pid);
        animals.forEach((a) => { if (a.penId === pid) a.penId = null; });
        drawPens();
        drawPanel();
        toast(t('a.map.penDeleted'));
      } catch (err) {
        toast(errText(err));
      }
    }));
  }

  function select(id: string, fly: boolean): void {
    selected = id;
    drawPanel();
    renderMarkers();
    demoRef?.select(id);
    const a = animals.find((x) => x.id === id);
    if (fly && a && a.lat != null && a.lng != null && map) map.flyTo({ center: [a.lng, a.lat], zoom: Math.max(map.getZoom(), 15), essential: false });
    if (window.matchMedia('(max-width: 767px)').matches) $('#panel', el)!.dataset.sheet = 'half';
  }

  function markerEl(a: AnimalDto): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    const isDraggable = a.controlMode === 'GPS_MANUAL' || (dragOn && !!a.isDemo);
    b.className = `amark ${statusClass(a)}${a.isDemo ? ' demo' : ''}${a.id === selected ? ' sel' : ''}${isDraggable ? ' draggable' : ''}`;
    b.setAttribute('aria-label', `${a.name}${a.isDemo ? ` (${t('a.demo.tag')})` : ''}, ${a.status === 'danger' ? t('a.st.danger') : a.status === 'offline' ? t('a.st.offline') : t('a.st.ok')}`);
    b.addEventListener('click', (e) => { e.stopPropagation(); select(a.id, false); });
    return b;
  }

  function renderMarkers(): void {
    if (!map || !ML || !mapReady || dragging) return;
    markers.forEach((m) => m.remove());
    markers = [];
    const pos = animals.filter((a) => a.lat != null && a.lng != null);
    const cluster = pos.length > CLUSTER_MIN && map.getZoom() < 16;
    const add = (lng: number, lat: number, node: HTMLElement, id?: string) => {
      const aObj = animals.find((x) => x.id === id);
      const isGpsManual = aObj?.controlMode === 'GPS_MANUAL';
      const isDemoDrag = dragOn && !!aObj?.isDemo;
      const canDrag = isDemoDrag || isGpsManual;
      const mk = new ML!.Marker({ element: node, draggable: canDrag }).setLngLat([lng, lat]).addTo(map!);
      if (canDrag) {
        // MapLibre's marker drag listens on the map's mousedown, so do not stop propagation;
        // instead disable map dragPan for the duration of the gesture.
        node.style.touchAction = 'none';
        node.style.cursor = 'grab';
        const panOff = () => { map?.dragPan.disable(); };
        const panOn = () => { map?.dragPan.enable(); };
        node.addEventListener('mousedown', panOff);
        node.addEventListener('touchstart', panOff, { passive: true });
        node.addEventListener('pointerdown', panOff);
        window.addEventListener('mouseup', panOn, { once: true });
        window.addEventListener('touchend', panOn, { once: true });
        window.addEventListener('touchcancel', panOn, { once: true });
        window.addEventListener('pointerup', panOn, { once: true });
        mk.on('dragstart', () => { dragging = true; panOff(); });
        mk.on('dragend', async () => {
          dragging = false;
          panOn();
          const p = mk.getLngLat();
          if (isGpsManual && aObj?.collarId) {
            const prev = { lat: aObj.lat, lng: aObj.lng, src: aObj.positionSource };
            aObj.lat = p.lat;
            aObj.lng = p.lng;
            aObj.positionSource = 'MANUAL';
            pendingDrag.add(aObj.id);
            try {
              await collarControlApi.setManualPosition(aObj.collarId, p.lat, p.lng);
              toast(t('a.map.markerMoved'));
            } catch (err) {
              const cur = animals.find((x) => x.id === aObj.id) ?? aObj;
              cur.lat = prev.lat;
              cur.lng = prev.lng;
              cur.positionSource = prev.src;
              toast(`${t('a.map.markerMoveFail')} ${errText(err)}`);
              pendingDrag.delete(aObj.id);
              renderMarkers();
              if (selected === aObj.id) drawPanel();
              return;
            }
            pendingDrag.delete(aObj.id);
            lastTickHash = '';
            if (selected === aObj.id) drawPanel();
          } else {
            dragDrop(id!, p.lng, p.lat);
          }
        });
      }
      markers.push(mk);
    };
    if (!cluster) { pos.forEach((a) => add(a.lng!, a.lat!, markerEl(a), a.id)); return; }
    const cells = new Map<string, AnimalDto[]>();
    for (const a of pos) {
      const p = map.project([a.lng!, a.lat!]);
      const k = `${Math.floor(p.x / 56)}:${Math.floor(p.y / 56)}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(a);
    }
    cells.forEach((g) => {
      if (g.length === 1 || g.some((a) => a.id === selected)) { g.forEach((a) => add(a.lng!, a.lat!, markerEl(a), a.id)); return; }
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'cluster num';
      c.textContent = String(g.length);
      c.setAttribute('aria-label', `${g.length}`);
      const lng = g.reduce((s, a) => s + a.lng!, 0) / g.length, lat = g.reduce((s, a) => s + a.lat!, 0) / g.length;
      c.addEventListener('click', (e) => { e.stopPropagation(); map!.easeTo({ center: [lng, lat], zoom: Math.min(18, map!.getZoom() + 2) }); });
      add(lng, lat, c);
    });
  }

  function fitAll(): void {
    if (!map || !ML) return;
    const b = new ML.LngLatBounds();
    let n = 0;
    animals.forEach((a) => { if (a.lat != null && a.lng != null) { b.extend([a.lng, a.lat]); n++; } });
    pens.forEach((p) => p.polygon.coordinates[0]?.forEach((c) => { b.extend([c[0], c[1]]); n++; }));
    if (n) map.fitBounds(b, { padding: 80, maxZoom: 16, duration: 500 });
  }

  function drawPens(): void {
    if (!map || !ML) return;
    const prim = cssVar('--primary');
    const fc = { type: 'FeatureCollection' as const, features: pens.map((p) => ({ type: 'Feature' as const, properties: { id: p.id, demo: p.isDemo ? 1 : 0 }, geometry: p.polygon })) };
    const src = map.getSource('pens') as import('maplibre-gl').GeoJSONSource | undefined;
    if (src) { src.setData(fc as never); } else {
      map.addSource('pens', { type: 'geojson', data: fc as never });
      map.addLayer({ id: 'pens-fill', type: 'fill', source: 'pens', paint: { 'fill-color': prim, 'fill-opacity': 0.1 } });
      map.addLayer({ id: 'pens-line', type: 'line', source: 'pens', filter: ['==', ['get', 'demo'], 0], paint: { 'line-color': prim, 'line-width': 2 } });
      map.addLayer({ id: 'pens-line-demo', type: 'line', source: 'pens', filter: ['==', ['get', 'demo'], 1], paint: { 'line-color': prim, 'line-width': 2, 'line-dasharray': [2, 2] } });
    }
    penMarkers.forEach((m) => m.remove());
    penMarkers = pens.map((p) => {
      const n = document.createElement('span');
      n.className = 'pen-chip glass-light';
      n.textContent = p.isDemo ? `${p.name} (${t('a.demo.tag').toLowerCase()})` : p.name;
      // a demo pen may sit exactly on a real one: move its label down so the two do not overlap
      return new ML!.Marker({ element: n, offset: p.isDemo ? [0, 30] : [0, 0] }).setLngLat(centroid(p)).addTo(map!);
    });
  }

  function updateDrawLayers(): void {
    if (!map || !mapReady) return;
    const prim = cssVar('--primary');
    const src = map.getSource('draw-temp') as import('maplibre-gl').GeoJSONSource | undefined;
    let feat: any = null;
    if (drawPoints.length >= 3) {
      feat = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...drawPoints, drawPoints[0]]] } };
    } else if (drawPoints.length === 2) {
      feat = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawPoints } };
    } else if (drawPoints.length === 1) {
      feat = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: drawPoints[0] } };
    }
    const fc = { type: 'FeatureCollection', features: feat ? [feat] : [] };
    if (src) {
      src.setData(fc as any);
    } else {
      map.addSource('draw-temp', { type: 'geojson', data: fc as any });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw-temp', paint: { 'fill-color': prim, 'fill-opacity': 0.25 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw-temp', paint: { 'line-color': prim, 'line-width': 3, 'line-dasharray': [2, 1] } });
    }
  }

  function updateDrawToolbar(): void {
    const undoBtn = $<HTMLButtonElement>('#draw-undo', el);
    const finishBtn = $<HTMLButtonElement>('#draw-finish', el);
    const countEl = $('#draw-count', el);
    const drawBtn = $('#m-draw', el);

    if (drawBtn) drawBtn.classList.toggle('active', drawing);
    if (undoBtn) undoBtn.disabled = drawPoints.length === 0;
    if (finishBtn) finishBtn.disabled = drawPoints.length < 3;
    if (countEl) {
      if (drawPoints.length < 3) {
        countEl.textContent = t('a.map.drawPoints', { n: drawPoints.length });
        countEl.classList.remove('ready');
      } else {
        countEl.textContent = t('a.map.drawReady', { n: drawPoints.length });
        countEl.classList.add('ready');
      }
    }
    if (drawMarkers.length > 0) {
      const firstEl = drawMarkers[0].getElement();
      if (firstEl) firstEl.classList.toggle('ready', drawPoints.length >= 3);
    }
  }

  function addDrawPoint(lng: number, lat: number): void {
    if ('vibrate' in navigator) { try { navigator.vibrate([15]); } catch {} }
    drawPoints.push([lng, lat]);
    const idx = drawPoints.length - 1;
    const isFirst = idx === 0;

    const dot = document.createElement('div');
    dot.className = 'draw-vertex' + (isFirst ? ' first' : '');
    if (isFirst) {
      dot.title = t('a.map.drawFinish');
    }

    dot.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (isFirst && drawPoints.length >= 3) {
        finishDrawing();
      }
    });

    const mk = new ML!.Marker({ element: dot }).setLngLat([lng, lat]).addTo(map!);
    drawMarkers.push(mk);

    updateDrawLayers();
    updateDrawToolbar();
  }

  function undoDrawPoint(): void {
    if (drawPoints.length === 0) return;
    drawPoints.pop();
    const mk = drawMarkers.pop();
    mk?.remove();
    updateDrawLayers();
    updateDrawToolbar();
  }

  function startDrawing(): void {
    if (!mapReady || !map) return;
    if ('vibrate' in navigator) { try { navigator.vibrate([20]); } catch {} }
    drawing = true;
    drawPoints = [];
    drawMarkers.forEach((m) => m.remove());
    drawMarkers = [];
    const bar = $('#draw-bar', el);
    if (bar) {
      bar.style.display = 'flex';
    }
    map.getCanvas().style.cursor = 'crosshair';
    updateDrawLayers();
    updateDrawToolbar();
  }

  function stopDrawing(): void {
    drawing = false;
    drawPoints = [];
    drawMarkers.forEach((m) => m.remove());
    drawMarkers = [];
    const bar = $('#draw-bar', el);
    if (bar) bar.style.display = 'none';
    const drawBtn = $('#m-draw', el);
    if (drawBtn) drawBtn.classList.remove('active');
    if (map) {
      map.getCanvas().style.cursor = '';
      const src = map.getSource('draw-temp') as import('maplibre-gl').GeoJSONSource | undefined;
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
    }
  }

  function finishDrawing(): void {
    if (drawPoints.length < 3) {
      toast(t('a.map.penMinPoints'));
      return;
    }
    const closedRing: [number, number][] = [...drawPoints, drawPoints[0]];

    formModal({
      title: t('a.map.penTitle'),
      submitLabel: t('a.map.penSave'),
      body: html`
        <div class="field">
          <label for="pen-name">${t('a.map.penName')}</label>
          <input class="input" id="pen-name" name="name" required placeholder="${t('a.map.penNamePh')}" autocomplete="off">
        </div>
        <div class="field">
          <label for="pen-color">${t('a.map.penColor')}</label>
          <div style="display:flex;gap:0.75rem;align-items:center;margin-top:0.35rem;">
            <input type="color" id="pen-color" name="color" value="${cssVar('--primary')}" style="width:48px;height:40px;padding:2px;border-radius:var(--r-chip,12px);cursor:pointer;border:1px solid var(--line-soft);background:var(--surface-2-white);">
          </div>
        </div>
        ${animals.length > 0 ? html`
          <div class="field">
            <label>${t('a.map.penAnimals')}</label>
            <div style="max-height:160px;overflow-y:auto;border:1px solid var(--line-soft);border-radius:var(--r-field,16px);padding:0.75rem;background:var(--surface-0);display:flex;flex-direction:column;gap:0.4rem;">
              ${animals.map((a) => html`
                <label class="check" style="margin:0;font-size:14px;">
                  <input type="checkbox" name="animalId" value="${a.id}">
                  <span><strong>${a.name}</strong> · ${t('a.map.penAnimalTag', { tag: a.tag })} (${speciesName(a.species)})</span>
                </label>
              `)}
            </div>
          </div>
        ` : ''}
      `,
      async onSubmit(form) {
        const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement)?.value?.trim();
        const name = v('name');
        if (!name) return t('a.err.required');
        const color = v('color') || cssVar('--primary');
        const animalCheckboxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="animalId"]:checked'));
        const animalIds = animalCheckboxes.map((cb) => cb.value);

        try {
          const created = await post<PenDto>('/geofences', {
            name,
            color,
            polygon: {
              type: 'Polygon',
              coordinates: [closedRing],
            },
            ...(animalIds.length > 0 ? { animalIds } : {}),
          });
          pens.push(created);
          if (animalIds.length > 0) {
            animals.forEach((a) => {
              if (animalIds.includes(a.id)) a.penId = created.id;
            });
          }
          drawPens();
          drawPanel();
          toast(t('a.map.penSaved'));
          stopDrawing();
        } catch (e) {
          throw e;
        }
      },
    });
  }

  async function initMap(): Promise<void> {
    try {
      const [mod, worker] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'), import('maplibre-gl/dist/maplibre-gl.css')]);
      if (disposed) return;
      // v6 loads its tile worker from a separate file; Vite serves it as a hashed asset from /assets (same origin, allowed by worker-src 'self')
      mod.setWorkerUrl(worker.default);
      ML = mod;
      const start = animals.find((a) => a.lat != null && a.lng != null);
      map = new mod.Map({
        container: $('#map', el)!, style: STYLE_URL,
        center: start ? [start.lng!, start.lat!] : [51.15, 43.65], zoom: start ? 14 : 8,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, attributionControl: { compact: false },
      });
      if (disposed) {
        map.remove();
        map = null;
        return;
      }
      map.touchZoomRotate.disableRotation();
      map.keyboard.enable();
      map.getCanvas().setAttribute('aria-label', t('a.map.container'));
      timers.push(window.setTimeout(() => { if (!mapReady) $('#map-notice', el)!.hidden = false; }, 10000));
      map.on('load', () => {
        if (disposed) return;
        mapReady = true;
        $('#map-notice', el)!.hidden = true;
        if (dataReady) {
          drawPens(); renderMarkers();
          const at = ctx.query.get('at')?.split(',').map(Number);
          const sel = animals.find((a) => a.id === selected);
          if (sel && sel.lat != null && sel.lng != null && map) map.jumpTo({ center: [sel.lng, sel.lat], zoom: 16 });
          else if (at && at.length === 2 && at.every(Number.isFinite) && map) map.jumpTo({ center: [at[1], at[0]], zoom: 16 });
          else fitAll();
        }
      });
      map.on('zoomend', renderMarkers);
      // style or tile failures must not leave a silent blank map: show the notice (the panel list keeps working)
      let mapErrAt = 0;
      map.on('error', (e) => {
        console.warn('[site] map error:', e?.error?.message ?? e);
        if (disposed) return;
        mapErrAt = Date.now();
        const n = $('#map-notice', el); if (n) n.hidden = false;
      });
      map.on('idle', () => {
        if (disposed || !mapReady || Date.now() - mapErrAt < 1500) return;
        const n = $('#map-notice', el); if (n) n.hidden = true;
      });
      // click-to-place: "Поставить на карте" picks for the panel's animal, otherwise the animal selected on the map is placed (pilot mode)
      const placeAtPoint = (lng: number, lat: number): void => {
        if (drawing) {
          addDrawPoint(lng, lat);
          return;
        }
        if (pickHandler) { pickHandler(lng, lat); return; }
        const a = placeHandler && selected ? animals.find((x) => x.id === selected) : undefined;
        if (placeHandler && a?.isDemo) placeHandler(a.id, lng, lat);
      };
      let lastTouchPlace = 0;
      map.on('click', (e) => { if (Date.now() - lastTouchPlace > 700) placeAtPoint(e.lngLat.lng, e.lngLat.lat); });
      // touch taps: not every touch browser delivers a click after MapLibre's touch handling, so a short, still pointer tap is handled here too
      const cv = map.getCanvasContainer();
      let down: { x: number; y: number; t: number } | null = null;
      cv.addEventListener('pointerdown', (e) => { down = e.pointerType === 'touch' && e.isPrimary ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; });
      cv.addEventListener('pointerup', (e) => {
        const d = down; down = null;
        if (!d || e.pointerType !== 'touch' || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || Date.now() - d.t > 600) return;
        if (!(e.target as HTMLElement).classList.contains('maplibregl-canvas') || !map) return;
        const r = cv.getBoundingClientRect();
        const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
        lastTouchPlace = Date.now();
        placeAtPoint(ll.lng, ll.lat);
      });
      map.on('moveend', () => { if (animals.length > CLUSTER_MIN) renderMarkers(); });
    } catch (e) {
      console.warn('[site] map unavailable:', e);
      $('#map-notice', el)!.hidden = false;
    }
  }

  const loadInitialData = async (): Promise<void> => {
    try {
      [animals, pens] = await Promise.all([fetchAll(), get<PenDto[]>('/geofences')]);
      if (disposed || !el.isConnected) return;
      dataReady = true;
      updatedAt = Date.now();
      drawPanel();
      if (mapReady) {
        drawPens();
        renderMarkers();
        const at = ctx.query.get('at')?.split(',').map(Number);
        const sel = animals.find((a) => a.id === selected);
        if (sel && sel.lat != null && sel.lng != null && map) map.jumpTo({ center: [sel.lng, sel.lat], zoom: 16 });
        else if (at && at.length === 2 && at.every(Number.isFinite) && map) map.jumpTo({ center: [at[1], at[0]], zoom: 16 });
        else fitAll();
      }
    } catch (e) {
      if (disposed || !el.isConnected) return;
      panelBody.innerHTML = errorState(e).s;
      $('#retry', panelBody)?.addEventListener('click', () => {
        panelBody.innerHTML = skeleton(3).s;
        void loadInitialData();
      });
    }
  };

  void loadInitialData();
  void initMap();

  $('#m-in', el)!.addEventListener('click', () => map?.zoomIn());
  $('#m-out', el)!.addEventListener('click', () => map?.zoomOut());
  $('#m-fit', el)!.addEventListener('click', fitAll);
  $('#m-loc', el)!.addEventListener('click', () => {
    if (!navigator.geolocation) { toast(t('a.map.locateFail')); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      if (!map || !ML) return;
      me?.remove();
      const n = document.createElement('span'); n.className = 'me-dot';
      me = new ML.Marker({ element: n }).setLngLat([p.coords.longitude, p.coords.latitude]).addTo(map);
      map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.getZoom(), 15) });
    }, () => toast(t('a.map.locateFail')), { enableHighAccuracy: true, timeout: 10000 });
  });
  $('#m-draw', el)?.addEventListener('click', () => {
    if (drawing) stopDrawing();
    else startDrawing();
  });
  $('#draw-undo', el)?.addEventListener('click', undoDrawPoint);
  $('#draw-finish', el)?.addEventListener('click', finishDrawing);
  $('#draw-cancel', el)?.addEventListener('click', stopDrawing);
  $('#draw-cancel-mobile', el)?.addEventListener('click', stopDrawing);
  const panel = $('#panel', el)!;
  const toggle = $('#sheet-toggle', el)!;
  toggle.addEventListener('click', () => {
    if ('vibrate' in navigator) { try { navigator.vibrate([15]); } catch {} }
    const order = ['peek', 'half', 'full'];
    const next = order[(order.indexOf(panel.dataset.sheet!) + 1) % 3];
    panel.dataset.sheet = next;
    toggle.setAttribute('aria-label', next === 'full' ? t('a.map.collapse') : t('a.map.expand'));
  });

  // ---- demo panel (owner, MANUAL / AUTO) ----
  async function reload(): Promise<void> {
    const [a, p] = await Promise.all([fetchAll(), get<PenDto[]>('/geofences')]);
    if (disposed) return;
    animals = a; pens = p; updatedAt = Date.now();
    if (selected && !animals.some((x) => x.id === selected)) selected = null;
    if (!panelBody.querySelector('#mq:focus')) drawPanel();
    drawPens(); renderMarkers();
    demo.update();
  }
  const demoBox = $('#demo-box', el)!;
  demoRef = null;
  const demo = mountDemoPanel(demoBox, {
    ctx,
    animals: () => animals,
    pens: () => pens,
    refresh: reload,
    setPick: (h) => { pickHandler = h; if (map) map.getCanvas().style.cursor = h ? 'crosshair' : ''; },
    setDrag: (on, onDrop) => {
      const changed = on !== dragOn;
      dragOn = on; dragDrop = onDrop;
      $('.map-area', el)?.classList.toggle('manual-edit', on);
      const hint = $('#map-hint', el); if (hint) hint.hidden = !on;
      if (changed) renderMarkers();
    },
    setPlace: (h) => { placeHandler = h; },
    select: (id) => select(id, true),
  });
  demoRef = demo;
  // a mode change made elsewhere (settings in another tab, auto-stop) is picked up by the shell's /simulation poll
  let lastMode = getSim()?.dataMode ?? 'REAL';
  const stopSim = onSim((s) => {
    const m = s?.dataMode ?? 'REAL';
    if (m === lastMode) return;
    lastMode = m;
    void reload().catch(() => undefined);
  });

  // Live SSE stream for instant sub-second animal movements and pulse on the tactical map
  let mapEventSource: StreamHandle | null = null;
  let lastPulseAlertAt = 0;
  function notifyCriticalPulse(name: string, bpm: number, pt?: PulseThreatDto | null) {
    const now = Date.now();
    if (now - lastPulseAlertAt < 25000) return;
    lastPulseAlertAt = now;
    if ('vibrate' in navigator) { try { navigator.vibrate([200, 100, 200]); } catch {} }
    const lang = getLang();
    const label = (lang === 'en' ? pt?.labelEn : lang === 'kk' ? pt?.labelKk : pt?.labelRu) || t('a.map.pulseStress');
    toast(t('a.map.pulseAlarm', { name, bpm: t('a.animal.bpm', { n: bpm }), label }));
  }

  try {
    mapEventSource = openStream({}, (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'telemetry' && (msg.animalId || msg.deviceId)) {
          const target = animals.find((x) => (msg.animalId && x.id === msg.animalId) || (msg.deviceId && x.collarId === msg.deviceId));
          if (target) {
            if (msg.latitude != null && msg.longitude != null && !pendingDrag.has(target.id) && !(dragging && selected === target.id)) {
              target.lat = msg.latitude;
              target.lng = msg.longitude;
            }
            if (msg.accuracyM != null) target.accuracyM = msg.accuracyM;
            if (msg.heartRate != null) target.lastHeartRate = msg.heartRate;
            if (msg.pulseThreat) target.pulseThreat = msg.pulseThreat;
            if (msg.lastSeenAt) target.lastSeenAt = msg.lastSeenAt;
            if (msg.controlMode) target.controlMode = msg.controlMode;
            if (msg.positionSource) target.positionSource = msg.positionSource;

            if (msg.pulseThreat?.level === 'CRITICAL') {
              notifyCriticalPulse(target.name, msg.heartRate ?? 0, msg.pulseThreat);
            }

            if (selected === target.id) drawPanel();
            renderMarkers();
          }
        }
      } catch {}
    });
  } catch {}

  // live positions poll (the SSE stream above carries the sub-second updates)
  let lastTickHash = '';
  const tick = async () => {
    if (!document.hidden && !disposed && dataReady && !dragging) {
      try {
        const fresh = await fetchAll();
        if (disposed) return;
        const hash = fresh.map((a) => `${a.id}:${a.lat}:${a.lng}:${a.status}:${a.lastHeartRate}:${a.controlMode}`).join('|');
        if (hash !== lastTickHash) {
          lastTickHash = hash;
          if (pendingDrag.size) {
            for (const f of fresh) {
              const cur = animals.find((x) => x.id === f.id);
              if (cur && pendingDrag.has(f.id)) { f.lat = cur.lat; f.lng = cur.lng; f.positionSource = cur.positionSource; }
            }
          }
          animals = fresh;
          updatedAt = Date.now();
          if (!panelBody.querySelector('#mq:focus')) drawPanel();
          renderMarkers();
          demo.update();
        }
      } catch { /* the shell banner reports the network state */ }
    }
    if (!disposed) timers.push(window.setTimeout(() => void tick(), 5000));
  };
  timers.push(window.setTimeout(() => void tick(), 5000));

  return () => {
    disposed = true;
    if (mapEventSource) mapEventSource.close();
    demo.dispose();
    stopSim();
    timers.forEach((x) => { window.clearTimeout(x); window.clearInterval(x); });
    markers.forEach((m) => m.remove());
    penMarkers.forEach((m) => m.remove());
    me?.remove();
    map?.remove();
    map = null;
    el.classList.remove('map-page');
    stopGuard();
  };
};
