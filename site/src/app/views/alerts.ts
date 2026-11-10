import { $, $$, html, raw, setHtml, type Safe } from '../../dom';
import { t } from '../../i18n';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { patch, post, request, type AlertDto, type AlertType } from '../api';
import { demoTag } from '../demo';
import { emptyState, errorState, offlineGuard, skeleton, timeEl, toast } from '../common';

const TYPES: AlertType[] = ['GEOFENCE_BREACH', 'GEOFENCE_RETURN', 'DEVICE_OFFLINE', 'DEVICE_RESTORED', 'SIGNAL_LIMIT_REACHED', 'GPS_LOST'];
const TYPE_ICON: Record<AlertType, string> = { GEOFENCE_BREACH: 'warning', GEOFENCE_RETURN: 'check-circle', DEVICE_OFFLINE: 'wifi-slash', DEVICE_RESTORED: 'check-circle', SIGNAL_LIMIT_REACHED: 'warning-circle', GPS_LOST: 'cloud-slash' };

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.al.title'));
  ctx.setActions(html`<button type="button" class="btn btn-secondary btn-sm" id="read-all" data-write>${t('a.al.readAll')}</button>`);
  const stop = offlineGuard(document.body);
  const st = { status: 'ACTIVE' as 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED', type: '', items: [] as AlertDto[], next: null as string | null, loaded: false };
  let seq = 0;
  let lastHash = '';
  const hashOf = (items: AlertDto[], next: string | null) => items.map((a) => `${a.id}:${a.status}:${a.isRead}:${a.severity}`).join('|') + `#${next ?? ''}`;

  setHtml(el, html`
    <div class="toolbar">
      <div class="chips" role="group" aria-label="${t('a.al.title')}">${(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((s) => html`<button type="button" class="chip-btn" data-status="${s}" aria-pressed="${s === st.status}">${s === 'ACTIVE' ? t('a.al.active') : s === 'ACKNOWLEDGED' ? t('a.al.ack') : t('a.al.resolved')}</button>`)}</div>
      <div class="field inline"><label class="sr-only" for="al-type">${t('a.al.type')}</label><select class="select" id="al-type"><option value="">${t('a.al.anyType')}</option>${TYPES.map((x) => html`<option value="${x}">${t(`a.al.t.${x}` as 'a.al.t.GPS_LOST')}</option>`)}</select></div>
    </div>
    <div id="list" aria-live="polite"></div>`);
  const list = $('#list', el)!;

  const card = (a: AlertDto): Safe => html`
    <li class="alert-card sev-${a.severity.toLowerCase()} ${a.isRead ? '' : 'unread'}" data-id="${a.id}">
      <div class="alert-head">${raw(icon(TYPE_ICON[a.type] || 'warning', 22))}<h2 class="alert-title">${t(`a.al.t.${a.type}` as 'a.al.t.GPS_LOST')}${demoTag(a.isDemo)}</h2>${a.isRead ? '' : html`<span class="sr-only">${t('a.al.unread')}</span>`}</div>
      <p>${a.message}</p>
      <p class="caption muted">${a.animalName ?? ''}${a.penName ? ` · ${a.penName}` : ''} ${timeEl(a.createdAt)}</p>
      <div class="alert-actions">
        ${a.animalId ? html`<a class="btn btn-secondary btn-sm" href="/app/herd/${a.animalId}">${t('a.co.toProfile')}</a>` : ''}
        ${a.lat != null && a.lng != null ? html`<a class="btn btn-ghost btn-sm" href="/app/map?at=${a.lat},${a.lng}${a.animalId ? `&animal=${a.animalId}` : ''}">${t('a.map.showOnMap')}</a>` : ''}
        ${a.status === 'ACTIVE' ? html`<button type="button" class="btn btn-secondary btn-sm" data-set="ACKNOWLEDGED" data-write>${t('a.al.accept')}</button>` : ''}
        ${a.status !== 'RESOLVED' ? html`<button type="button" class="btn btn-secondary btn-sm" data-set="RESOLVED" data-write>${t('a.al.close')}</button>` : ''}
      </div>
    </li>`;

  function draw(): void {
    if (!st.loaded) { list.innerHTML = skeleton(4).s; return; }
    if (!st.items.length) { list.innerHTML = emptyState(t('a.al.empty')).s; return; }
    list.innerHTML = html`<ul class="alert-list">${st.items.map(card)}</ul>${st.next ? html`<p class="more"><button type="button" class="btn btn-secondary" id="more">${t('a.al.more')}</button></p>` : ''}`.s;
    $('#more', list)?.addEventListener('click', () => void load(false));
    $$('[data-set]', list).forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest<HTMLElement>('[data-id]')!.dataset.id!;
      if ('vibrate' in navigator) { try { navigator.vibrate([25]); } catch {} }
      b.setAttribute('aria-busy', 'true');
      try {
        await patch<AlertDto>(`/alerts/${id}/status`, { status: b.dataset.set });
        st.items = st.items.filter((x) => x.id !== id);
        draw();
        ctx.refreshChrome();
      } catch (e) { toast((e as Error).message); b.removeAttribute('aria-busy'); }
    }));
  }

  async function load(reset: boolean): Promise<void> {
    const my = ++seq;
    if (reset) { st.items = []; st.next = null; st.loaded = false; draw(); }
    const p = new URLSearchParams({ status: st.status, limit: '50' });
    if (st.type) p.set('type', st.type);
    if (!reset && st.next) p.set('cursor', st.next);
    try {
      const r = await request<AlertDto[]>('GET', `/alerts?${p}`);
      if (my !== seq || !el.isConnected) return;
      st.items = reset ? r.data : st.items.concat(r.data);
      st.next = r.next; st.loaded = true;
      lastHash = hashOf(st.items, st.next);
      draw();
    } catch (e) {
      if (my !== seq || !el.isConnected) return;
      list.innerHTML = errorState(e).s;
      $('#retry', list)?.addEventListener('click', () => void load(true));
    }
  }

  $$('.chip-btn', el).forEach((b) => b.addEventListener('click', () => {
    st.status = b.dataset.status as typeof st.status;
    $$('.chip-btn', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    void load(true);
  }));
  $<HTMLSelectElement>('#al-type', el)!.addEventListener('change', (e) => { st.type = (e.target as HTMLSelectElement).value; void load(true); });
  $('#read-all')!.addEventListener('click', async () => {
    try { await post('/alerts/read-all'); void load(true); ctx.refreshChrome(); } catch (e) { toast((e as Error).message); }
  });
  void load(true);

  // Auto-refresh alerts: 5 s in REAL mode, 10 s in AUTO mode; the first page only, so "load more" is not reset needlessly
  let timer = 0;
  const poll = async () => {
    if (!document.hidden && !st.next && st.loaded && el.isConnected) {
      const my = ++seq;
      const p = new URLSearchParams({ status: st.status, limit: '50' });
      if (st.type) p.set('type', st.type);
      try {
        const r = await request<AlertDto[]>('GET', `/alerts?${p}`);
        if (my === seq && el.isConnected) {
          // unchanged list: leave the DOM (and the buttons under the cursor) alone
          const h = hashOf(r.data, r.next);
          if (h !== lastHash) { lastHash = h; st.items = r.data; st.next = r.next; draw(); ctx.refreshChrome(); }
        }
      } catch { /* the shell banner reports the network state */ }
    }
    if (el.isConnected) timer = window.setTimeout(() => void poll(), 5000);
  };
  timer = window.setTimeout(() => void poll(), 5000);
  return () => { seq++; window.clearTimeout(timer); stop(); };
};
