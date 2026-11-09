import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { get, request, type AnimalDto, type PenDto } from '../api';
import { demoTag } from '../demo';
import { absTime, animalBadge, emptyState, errorState, offlineGuard, pulseThreatBadge, skeleton, speciesName, timeAgo, toast } from '../common';
import { openAnimalForm } from './animal';
import { getSim, onSim } from '../demo';
import { mountDemoPanel } from './demo-panel';

// MapLibre is loaded lazily, only on this route (site-brief 8). Base map: OpenFreeMap (no key), OSM attribution from the style.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const CLUSTER_MIN = 30;
const cssVar = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

type MLMap = import('maplibre-gl').Map;

async function fetchAll(): Promise<AnimalDto[]> {
  const out: AnimalDto[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const r: { data: AnimalDto[]; next: string | null } = await request<AnimalDto[]>('GET', `/animals?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...r.data);
    cursor = r.next;
    if (!cursor) break;
  }
  return out;
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
  setHtml(el, html`<div class="map-wrap"><div class="map-loading" role="status">${t('a.map.loading')}</div>${skeleton(3)}</div>`);

  let animals: AnimalDto[] = [];
  let pens: PenDto[] = [];
  let updatedAt = Date.now();
  try {
    [animals, pens] = await Promise.all([fetchAll(), get<PenDto[]>('/geofences')]);
  } catch (e) {
    if (!el.isConnected) return;
    setHtml(el, html`<div class="map-wrap">${errorState(e)}</div>`);
    $('#retry', el)?.addEventListener('click', () => { void mount(el, ctx); });
    return () => { el.classList.remove('map-page'); stopGuard(); };
  }
  if (!el.isConnected) return;
  updatedAt = Date.now();

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

  setHtml(el, html`
    <div class="map-wrap">
      <div class="map-area">
        <div class="map" id="map" role="region" aria-label="${t('a.map.container')}"></div>
        <p class="map-hint" id="map-hint" hidden>${t('a.demo.hint')}</p>
        <p class="map-notice glass-light" id="map-notice" role="status" hidden>${t('a.map.mapFail')}</p>
        <div class="map-controls">
          <button type="button" class="map-btn glass-light" id="m-in" aria-label="${t('a.map.zoomIn')}">${raw(icon('plus', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-out" aria-label="${t('a.map.zoomOut')}">${raw(icon('minus', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-fit" aria-label="${t('a.map.fitAll')}">${raw(icon('corners-out', 22))}</button>
          <button type="button" class="map-btn glass-light" id="m-loc" aria-label="${t('a.map.locate')}">${raw(icon('crosshair-simple', 22))}</button>
        </div>
      </div>
      <aside class="map-panel glass-light" id="panel" data-sheet="peek" aria-label="${t('a.map.sheet')}">
        <button type="button" class="sheet-handle" id="sheet-toggle" aria-label="${t('a.map.expand')}"><span aria-hidden="true"></span></button>
        <div class="panel-scroll"><div id="demo-box" class="demo-box" hidden></div><div class="panel-inner" id="panel-body"></div></div>
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
      panelBody.innerHTML = html`
        <button type="button" class="btn btn-ghost btn-sm" id="back">${t('a.map.back')}</button>
        <h2 class="title-2">${sel.name} · ${sel.tag}</h2>
        <p>${animalBadge(sel)}</p>
        <p class="muted">${speciesName(sel.species)} · ${sel.penId ? pens.find((p) => p.id === sel.penId)?.name ?? '' : t('a.map.noPen')}</p>
        <p>${sel.lastHeartRate != null ? html`${pulseThreatBadge(sel.pulseThreat)} <span class="num">${sel.lastHeartRate} уд/мин</span> · ` : ''}<span class="muted">${sel.lat == null ? t('a.map.noPos') : `${timeAgo(sel.lastSeenAt)}`}</span></p>
        <p><a class="btn btn-primary btn-sm" href="/app/herd/${sel.id}">${t('a.map.openProfile')}</a></p>`.s;
      $('#back', panelBody)!.addEventListener('click', () => { selected = null; drawPanel(); renderMarkers(); });
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
      ${pens.length ? html`<h3 class="title-3">${t('a.map.pens')}</h3><ul class="pen-list">${pens.map((p) => html`<li>${p.name} <span class="caption muted">· ${p.animalsCount}</span></li>`)}</ul>` : html`<p class="muted">${t('a.map.noPens')}</p>`}`.s;
    $<HTMLInputElement>('#mq', panelBody)?.addEventListener('input', (e) => {
      query = (e.target as HTMLInputElement).value;
      const pos = (e.target as HTMLInputElement).selectionStart;
      drawPanel();
      const n = $<HTMLInputElement>('#mq', panelBody)!; n.focus(); if (pos != null) n.setSelectionRange(pos, pos);
    });
    $$('.prow', panelBody).forEach((b) => b.addEventListener('click', () => select(b.dataset.id!, true)));
    $('#p-add', panelBody)?.addEventListener('click', () => void openAnimalForm(ctx, undefined, () => location.reload()));
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
    b.className = `amark ${statusClass(a)}${a.isDemo ? ' demo' : ''}${a.id === selected ? ' sel' : ''}`;
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
      const canDrag = dragOn && !!id && !!animals.find((x) => x.id === id)?.isDemo;
      const mk = new ML!.Marker({ element: node, draggable: canDrag }).setLngLat([lng, lat]).addTo(map!);
      if (canDrag) {
        mk.on('dragstart', () => { dragging = true; });
        mk.on('dragend', () => { dragging = false; const p = mk.getLngLat(); dragDrop(id!, p.lng, p.lat); });
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
      map.touchZoomRotate.disableRotation();
      map.keyboard.enable();
      map.getCanvas().setAttribute('aria-label', t('a.map.container'));
      timers.push(window.setTimeout(() => { if (!mapReady) $('#map-notice', el)!.hidden = false; }, 10000));
      map.on('load', () => {
        mapReady = true;
        $('#map-notice', el)!.hidden = true;
        drawPens(); renderMarkers();
        const at = ctx.query.get('at')?.split(',').map(Number);
        const sel = animals.find((a) => a.id === selected);
        if (sel && sel.lat != null && sel.lng != null) map!.jumpTo({ center: [sel.lng, sel.lat], zoom: 16 });
        else if (at && at.length === 2 && at.every(Number.isFinite)) map!.jumpTo({ center: [at[1], at[0]], zoom: 16 });
        else fitAll();
      });
      map.on('zoomend', renderMarkers);
      // click-to-place: "Поставить на карте" picks for the panel's animal, otherwise the animal selected on the map is placed (pilot mode)
      const placeAtPoint = (lng: number, lat: number): void => {
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

  drawPanel();
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
  let mapEventSource: EventSource | null = null;
  try {
    mapEventSource = new EventSource('/api/v1/device/stream');
    mapEventSource.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'telemetry' && (msg.animalId || msg.deviceId)) {
          const target = animals.find((x) => (msg.animalId && x.id === msg.animalId) || (msg.deviceId && x.collarId === msg.deviceId));
          if (target) {
            if (msg.latitude != null && msg.longitude != null) {
              target.lat = msg.latitude;
              target.lng = msg.longitude;
            }
            if (msg.accuracyM != null) target.accuracyM = msg.accuracyM;
            if (msg.heartRate != null) target.lastHeartRate = msg.heartRate;
            if (msg.pulseThreat) target.pulseThreat = msg.pulseThreat;
            if (msg.lastSeenAt) target.lastSeenAt = msg.lastSeenAt;

            if (selected === target.id) drawPanel();
            renderMarkers();
          }
        }
      } catch {}
    };
  } catch {}

  // live positions: 3 s in REAL and demo modes for real-time tracking without manual refresh
  const tick = async () => {
    if (!document.hidden && !disposed) {
      try {
        animals = await fetchAll();
        updatedAt = Date.now();
        if (!panelBody.querySelector('#mq:focus')) drawPanel();
        renderMarkers();
        demo.update();
      } catch { /* the shell banner reports the network state */ }
    }
    if (!disposed) timers.push(window.setTimeout(() => void tick(), 3000));
  };
  timers.push(window.setTimeout(() => void tick(), 3000));

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
    el.classList.remove('map-page');
    stopGuard();
  };
};
