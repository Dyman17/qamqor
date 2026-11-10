import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { navigate } from '../../router';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { request, get, type AnimalDto, type PenDto } from '../api';
import { animalBadge, emptyState, errorState, offlineGuard, pulseThreatBadge, skeleton, speciesName, timeEl } from '../common';
import { openAnimalForm } from './animal';

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.herd.title'));
  ctx.setActions(html`<button type="button" class="btn btn-primary btn-sm" id="add" data-write>${raw(icon('plus', 20))}${t('a.herd.add')}</button>`);
  const stopGuard = offlineGuard(document.body);
  const st = { search: '', status: '', pen: '', items: [] as AnimalDto[], next: null as string | null, loading: false, loaded: false };
  let pens: PenDto[] = [];
  let seq = 0;
  let lastHash = '';
  let polling = false;
  let paged = false; // "Load more" was used: the list is longer than page 1
  const hashOf = (items: AnimalDto[], next: string | null) => items.map((a) => `${a.id}|${a.name}|${a.tag}|${a.status}|${a.penId}|${a.collarId}|${a.lastHeartRate}|${a.pulseThreat?.level}|${a.lastSeenAt}`).join(';') + `#${next ?? ''}`;
  const penName = (id: string | null) => pens.find((p) => p.id === id)?.name ?? t('a.herd.noPen');
  const alive = () => el.isConnected;

  setHtml(el, html`
    <div class="toolbar">
      <div class="search"><label class="sr-only" for="q">${t('a.herd.search')}</label>${raw(icon('magnifying-glass', 20, 'search-ico'))}<input class="input" id="q" type="search" placeholder="${t('a.herd.search')}" autocomplete="off"><button type="button" class="icon-btn" id="q-clear" aria-label="${t('a.herd.clear')}" hidden>${raw(icon('x', 18))}</button></div>
      <div class="chips" role="group" aria-label="${t('a.herd.title')}">
        ${(['', 'danger', 'offline'] as const).map((s) => html`<button type="button" class="chip-btn" data-status="${s}" aria-pressed="${s === ''}">${s === '' ? t('a.herd.all') : s === 'danger' ? t('a.herd.out') : t('a.herd.off')}</button>`)}
      </div>
      <div class="field inline"><label class="sr-only" for="pen">${t('a.herd.pen')}</label><select class="select" id="pen"><option value="">${t('a.herd.anyPen')}</option></select></div>
    </div>
    <div id="results" aria-live="polite"></div>`);
  const results = $('#results', el)!;
  const q = $<HTMLInputElement>('#q', el)!;
  const clear = $('#q-clear', el)!;
  const penSelect = $<HTMLSelectElement>('#pen', el);

  // Load pens asynchronously without blocking initial render
  void get<PenDto[]>('/geofences').then((p) => {
    if (!alive()) return;
    pens = p;
    if (penSelect) {
      const keep = penSelect.value || st.pen;
      penSelect.innerHTML = html`<option value="">${t('a.herd.anyPen')}</option>${pens.map((x) => html`<option value="${x.id}">${x.name}</option>`)}`.s;
      penSelect.value = keep;
    }
    if (st.loaded) draw();
  }).catch(() => {});

  const rowsDesktop = (items: AnimalDto[]): Safe => html`
    <table class="table herd-table"><thead><tr>${['tag', 'name', 'species', 'pen', 'collar', 'status', 'pulse', 'seen'].map((c) => html`<th scope="col">${t(`a.herd.c.${c}` as 'a.herd.c.tag')}</th>`)}</tr></thead>
    <tbody>${items.map((a) => html`<tr class="row-link"><td class="num"><a class="row-a" href="/app/herd/${a.id}">${a.tag}</a></td><td>${a.name}</td><td>${speciesName(a.species)}</td><td>${penName(a.penId)}</td><td>${a.collarId ?? t('a.herd.noCollar')}</td><td>${animalBadge(a)}</td><td>${a.lastHeartRate != null ? html`<span class="num">${a.lastHeartRate}</span> ${pulseThreatBadge(a.pulseThreat)}` : '—'}</td><td>${timeEl(a.lastSeenAt)}</td></tr>`)}</tbody></table>`;
  const rowsCards = (items: AnimalDto[]): Safe => html`
    <ul class="cards herd-cards">${items.map((a) => html`<li><a class="card-row" href="/app/herd/${a.id}"><span class="card-main"><strong>${a.name}</strong><span class="caption muted">${speciesName(a.species)} · ${a.tag} · ${penName(a.penId)}${a.lastHeartRate != null ? ` · ${t('a.animal.bpm', { n: a.lastHeartRate })}` : ''}</span></span><span class="card-side">${pulseThreatBadge(a.pulseThreat)}</span></a></li>`)}</ul>`;

  function syncChips(): void { $$('.chip-btn', el).forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.status ?? '') === st.status))); }

  function draw(): void {
    if (!st.loaded) { results.innerHTML = skeleton(6).s; return; }
    if (!st.items.length) {
      const filtered = st.search || st.status || st.pen;
      results.innerHTML = (filtered
        ? emptyState(t('a.herd.noMatch'), undefined, html`<button type="button" class="btn btn-secondary" id="reset">${t('a.herd.reset')}</button>`)
        : emptyState(t('a.herd.empty'), undefined, html`<button type="button" class="btn btn-primary" id="empty-add" data-write>${t('a.herd.add')}</button>`)).s;
      $('#reset', results)?.addEventListener('click', () => { st.search = ''; st.status = ''; st.pen = ''; q.value = ''; clear.hidden = true; $<HTMLSelectElement>('#pen', el)!.value = ''; syncChips(); void load(true); });
      $('#empty-add', results)?.addEventListener('click', () => openAnimalForm(ctx, undefined, () => void load(true)));
      return;
    }
    results.innerHTML = (html`${rowsDesktop(st.items)}${rowsCards(st.items)}${st.next ? html`<p class="more"><button type="button" class="btn btn-secondary" id="more">${t('a.herd.more')}</button></p>` : ''}`).s;
    $('#more', results)?.addEventListener('click', () => void load(false));
    $$('tr.row-link', results).forEach((tr) => tr.addEventListener('click', (e) => { if (!(e.target as Element).closest('a')) { const a = $('a', tr) as HTMLAnchorElement; void navigate(a.pathname); } }));
  }

  async function load(reset: boolean): Promise<void> {
    if (st.loading && !reset) return;
    const my = ++seq;
    st.loading = true;
    if (reset) { st.items = []; st.next = null; st.loaded = false; paged = false; draw(); } else paged = true;
    const p = new URLSearchParams({ limit: '50' });
    if (st.search) p.set('search', st.search);
    if (st.status) p.set('status', st.status);
    if (st.pen) p.set('penId', st.pen);
    if (!reset && st.next) p.set('cursor', st.next);
    try {
      const r = await request<AnimalDto[]>('GET', `/animals?${p}`);
      if (my !== seq || !alive()) return;
      st.items = reset ? r.data : st.items.concat(r.data);
      st.next = r.next;
      st.loaded = true;
      lastHash = hashOf(st.items, st.next);
      draw();
    } catch (e) {
      if (my !== seq || !alive()) return;
      results.innerHTML = errorState(e).s;
      $('#retry', results)?.addEventListener('click', () => void load(true));
    } finally { if (my === seq) st.loading = false; }
  }

  let timer = 0;
  q.addEventListener('input', () => { clear.hidden = !q.value; window.clearTimeout(timer); timer = window.setTimeout(() => { st.search = q.value.trim(); void load(true); }, 300); });
  clear.addEventListener('click', () => { q.value = ''; clear.hidden = true; st.search = ''; void load(true); q.focus(); });
  $$('.chip-btn', el).forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.status ?? ''; syncChips(); void load(true); }));
  $<HTMLSelectElement>('#pen', el)!.addEventListener('change', (e) => { st.pen = (e.target as HTMLSelectElement).value; void load(true); });
  $('#add')!.addEventListener('click', () => openAnimalForm(ctx, undefined, () => void load(true)));
  void load(true);

  // Фоновое автообновление списка каждые 3 секунды без потери фокуса/поиска
  // not while a manual load is running, not past page 1 ("Load more" was used: a refresh would drop the extra pages), never overlapping
  const pollTimer = window.setInterval(async () => {
    if (!alive() || document.hidden || st.loading || st.search || paged || polling) return;
    polling = true;
    const mySeq = seq;
    try {
      const p = new URLSearchParams({ limit: '50' });
      if (st.status) p.set('status', st.status);
      if (st.pen) p.set('penId', st.pen);
      const r = await request<AnimalDto[]>('GET', `/animals?${p}`);
      // a filter/search change (seq bump) while this request was in flight makes the response stale
      if (!alive() || st.search || st.loading || paged || mySeq !== seq) return;
      const h = hashOf(r.data, r.next);
      if (h === lastHash) return;
      lastHash = h;
      st.items = r.data;
      st.next = r.next;
      draw();
    } catch { /* the shell banner reports the network state */ } finally { polling = false; }
  }, 3000);

  return () => { window.clearTimeout(timer); window.clearInterval(pollTimer); stopGuard(); seq++; };
};
