import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { navigate } from '../../router';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { request, get, type AnimalDto, type PenDto } from '../api';
import { animalBadge, emptyState, errorState, offlineGuard, skeleton, speciesName, timeEl } from '../common';
import { openAnimalForm } from './animal';

export const mount: AppView['mount'] = async (el, ctx) => {
  ctx.setTitle(t('a.herd.title'));
  ctx.setActions(html`<button type="button" class="btn btn-primary btn-sm" id="add" data-write>${raw(icon('plus', 20))}${t('a.herd.add')}</button>`);
  const stopGuard = offlineGuard(document.body);
  const st = { search: '', status: '', pen: '', items: [] as AnimalDto[], next: null as string | null, loading: false, loaded: false };
  let pens: PenDto[] = [];
  let seq = 0;
  try { pens = await get<PenDto[]>('/geofences'); } catch { /* pen names are optional here */ }
  const penName = (id: string | null) => pens.find((p) => p.id === id)?.name ?? t('a.herd.noPen');
  const alive = () => el.isConnected;

  setHtml(el, html`
    <div class="toolbar">
      <div class="search"><label class="sr-only" for="q">${t('a.herd.search')}</label>${raw(icon('magnifying-glass', 20, 'search-ico'))}<input class="input" id="q" type="search" placeholder="${t('a.herd.search')}" autocomplete="off"><button type="button" class="icon-btn" id="q-clear" aria-label="${t('a.herd.clear')}" hidden>${raw(icon('x', 18))}</button></div>
      <div class="chips" role="group" aria-label="${t('a.herd.title')}">
        ${(['', 'danger', 'offline'] as const).map((s) => html`<button type="button" class="chip-btn" data-status="${s}" aria-pressed="${s === ''}">${s === '' ? t('a.herd.all') : s === 'danger' ? t('a.herd.out') : t('a.herd.off')}</button>`)}
      </div>
      <div class="field inline"><label class="sr-only" for="pen">${t('a.herd.pen')}</label><select class="select" id="pen"><option value="">${t('a.herd.anyPen')}</option>${pens.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
    </div>
    <div id="results" aria-live="polite"></div>`);
  const results = $('#results', el)!;
  const q = $<HTMLInputElement>('#q', el)!;
  const clear = $('#q-clear', el)!;

  const rowsDesktop = (items: AnimalDto[]): Safe => html`
    <table class="table herd-table"><thead><tr>${['tag', 'name', 'species', 'pen', 'collar', 'status', 'seen'].map((c) => html`<th scope="col">${t(`a.herd.c.${c}` as 'a.herd.c.tag')}</th>`)}</tr></thead>
    <tbody>${items.map((a) => html`<tr class="row-link"><td class="num"><a class="row-a" href="/app/herd/${a.id}">${a.tag}</a></td><td>${a.name}</td><td>${speciesName(a.species)}</td><td>${penName(a.penId)}</td><td>${a.collarId ?? t('a.herd.noCollar')}</td><td>${animalBadge(a)}</td><td>${timeEl(a.lastSeenAt)}</td></tr>`)}</tbody></table>`;
  const rowsCards = (items: AnimalDto[]): Safe => html`
    <ul class="cards herd-cards">${items.map((a) => html`<li><a class="card-row" href="/app/herd/${a.id}"><span class="card-main"><strong>${a.name}</strong><span class="caption muted">${speciesName(a.species)} · ${a.tag} · ${penName(a.penId)}</span></span><span class="card-side">${animalBadge(a)}</span></a></li>`)}</ul>`;

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
    if (reset) { st.items = []; st.next = null; st.loaded = false; draw(); }
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
  return () => { window.clearTimeout(timer); stopGuard(); seq++; };
};
