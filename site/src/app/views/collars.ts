import { $, html, raw, type Safe } from '../../dom';
import { t } from '../../i18n';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { get, type CollarDto } from '../api';
import { collarBadge, emptyState, loadInto, offlineGuard, timeEl } from '../common';

export const rssi = (c: CollarDto): string => (c.signalRssi == null ? '—' : t('a.co.rssi', { n: c.signalRssi }));

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.co.title'));
  ctx.setActions(ctx.isOwner ? html`<a class="btn btn-primary btn-sm" href="/app/collars/connect">${raw(icon('plus', 20))}${t('a.co.connect')}</a>` : '');
  const stop = offlineGuard(document.body);
  void loadInto(el, () => get<CollarDto[]>('/devices'), (list) => {
    if (!list.length) {
      el.innerHTML = emptyState(t('a.co.empty'), ctx.isOwner ? undefined : t('a.co.workerHint'), ctx.isOwner ? html`<a class="btn btn-primary" href="/app/collars/connect">${t('a.co.connect')}</a>` : undefined).s;
      return;
    }
    const showFw = list.some((c) => c.firmwareVersion);
    const table: Safe = html`<table class="table collars-table"><thead><tr><th scope="col">${t('a.co.id')}</th><th scope="col">${t('a.co.animal')}</th><th scope="col">${t('a.co.status')}</th><th scope="col">${t('a.co.signal')}</th>${showFw ? html`<th scope="col">${t('a.co.fw')}</th>` : ''}<th scope="col">${t('a.co.seen')}</th></tr></thead>
      <tbody>${list.map((c) => html`<tr class="row-link"><td><a class="row-a" href="/app/collars/${encodeURIComponent(c.deviceId)}">${c.deviceId}</a></td><td>${c.animalName ?? t('a.co.unassigned')}</td><td>${collarBadge(c)}</td><td class="num">${rssi(c)}</td>${showFw ? html`<td>${c.firmwareVersion ?? '—'}</td>` : ''}<td>${timeEl(c.lastSeenAt)}</td></tr>`)}</tbody></table>`;
    const cards: Safe = html`<ul class="cards collars-cards">${list.map((c) => html`<li><a class="card-row" href="/app/collars/${encodeURIComponent(c.deviceId)}"><span class="card-main"><strong>${c.deviceId}</strong><span class="caption muted">${c.animalName ?? t('a.co.unassigned')} · ${rssi(c)}</span></span><span class="card-side">${collarBadge(c)}</span></a></li>`)}</ul>`;
    el.innerHTML = html`${table}${cards}<p class="caption muted rule">${t('a.co.offlineRule')}</p>`.s;
    el.querySelectorAll<HTMLElement>('tr.row-link').forEach((tr) => tr.addEventListener('click', (e) => { if (!(e.target as Element).closest('a')) ($('a', tr) as HTMLElement).click(); }));
  });
  return stop;
};
