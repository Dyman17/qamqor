import { $, html, raw, type Safe } from '../../dom';
import { t } from '../../i18n';
import { icon } from '../../ui/icons';
import type { AppView } from '../app';
import { ApiError, get, post, type CollarDto } from '../api';
import { collarBadge, emptyState, errText, loadInto, offlineGuard, timeEl, toast } from '../common';

export const rssi = (c: CollarDto): string => (c.signalRssi == null ? '—' : t('a.co.rssi', { n: c.signalRssi }));

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.co.title'));
  ctx.setActions(
    ctx.isOwner
      ? html`
        <button type="button" class="btn btn-primary btn-sm" id="btn-toggle-add">${raw(icon('plus', 18))} ${t('a.co.quickAdd')}</button>
        <a class="btn btn-secondary btn-sm" href="/app/collars/connect">${t('a.co.connect')}</a>`
      : '',
  );
  const stop = offlineGuard(document.body);
  const alive = () => el.isConnected;
  let pollTimer: number | null = null;
  let adding = false;
  let busy = false;
  let lastListHash = '';

  const addBox: Safe = ctx.isOwner
    ? html`
      <div id="add-collar-panel" class="panel-block" style="margin-bottom:var(--space-4);border-left:4px solid var(--primary);display:none;">
        <h2 class="title-2" style="display:flex;align-items:center;gap:0.4rem;">${raw(icon('cpu', 20))} ${t('a.co.quickAdd')}</h2>
        <p class="caption muted">${t('a.co.codeHint')}</p>
        <form id="collar-code-form" style="display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-top:0.75rem;" novalidate>
          <input type="text" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" class="input font-mono num" id="collar-code-input" placeholder="${t('a.co.codePlaceholder')}" style="max-width:220px;font-size:1.25rem;letter-spacing:0.12em;font-weight:700;padding:0.4rem 0.75rem;" autocomplete="off" required>
          <button type="submit" class="btn btn-primary" id="btn-submit-code">${t('a.co.addBtn')}</button>
        </form>
        <p class="field-error" id="code-err" role="alert" style="margin-top:0.5rem;" hidden></p>
      </div>`
    : html``;

  el.innerHTML = html`
    ${addBox}
    <div id="collars-list-wrap"></div>
  `.s;

  const listWrap = $('#collars-list-wrap', el)!;
  const panel = $('#add-collar-panel', el);
  const form = $<HTMLFormElement>('#collar-code-form', el);
  const codeInp = $<HTMLInputElement>('#collar-code-input', el);
  const errEl = $('#code-err', el);

  const toggle = () => {
    adding = !adding;
    if (panel) panel.style.display = adding ? 'block' : 'none';
    if (adding && codeInp) codeInp.focus();
  };

  $('#btn-toggle-add')?.addEventListener('click', toggle);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!codeInp || busy) return;
    const code = codeInp.value.trim().replace(/[^0-9]/g, '');
    if (code.length !== 8) {
      if (errEl) { errEl.textContent = t('a.co.codeBad'); errEl.hidden = false; }
      return;
    }
    if (errEl) errEl.hidden = true;
    busy = true;
    const btn = $('#btn-submit-code', el) as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      await post<{ collar: CollarDto }>('/devices', { code });
      toast(t('a.co.added', { code }));
      adding = false;
      if (panel) panel.style.display = 'none';
      codeInp.value = '';
      const fresh = await get<CollarDto[]>('/devices');
      renderTableAndCards(fresh);
      ctx.refreshChrome();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err instanceof ApiError && err.code === 'CONFLICT' ? t('a.cn.idTaken') : errText(err);
        errEl.hidden = false;
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  });

  function renderTableAndCards(list: CollarDto[]): void {
    lastListHash = list.map((c) => `${c.deviceId}:${c.status}:${c.animalId}:${c.lastSeenAt}`).join('|');
    if (!list.length) {
      listWrap.innerHTML = emptyState(
        t('a.co.empty'),
        ctx.isOwner ? undefined : t('a.co.workerHint'),
        ctx.isOwner ? html`<button type="button" class="btn btn-primary" id="btn-empty-add">${t('a.co.quickAdd')}</button>` : undefined,
      ).s;
      $('#btn-empty-add', listWrap)?.addEventListener('click', toggle);
      return;
    }

    const showFw = list.some((c) => c.firmwareVersion);
    const table: Safe = html`
      <table class="table collars-table">
        <thead>
          <tr>
            <th scope="col">${t('a.co.id')}</th>
            <th scope="col">${t('a.co.animal')}</th>
            <th scope="col">${t('a.co.status')}</th>
            <th scope="col">${t('a.co.signal')}</th>
            ${showFw ? html`<th scope="col">${t('a.co.fw')}</th>` : ''}
            <th scope="col">${t('a.co.seen')}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          ${list.map((c) => html`
            <tr class="row-link">
              <td><a class="row-a font-mono num" href="/app/collars/${encodeURIComponent(c.deviceId)}"><strong>${c.code ?? c.deviceId}</strong></a></td>
              <td>${c.animalId ? html`<a href="/app/herd/${c.animalId}">${c.animalName}</a>` : html`<span class="muted">${t('a.co.unassigned')}</span>`}</td>
              <td>${collarBadge(c)}</td>
              <td class="num">${rssi(c)}</td>
              ${showFw ? html`<td>${c.firmwareVersion ?? '—'}</td>` : ''}
              <td>${timeEl(c.lastSeenAt)}</td>
              <td style="text-align:right;">
                ${c.animalId ? html`<a class="btn btn-ghost btn-sm" href="/app/herd/${c.animalId}">${t('a.co.toProfile')}</a>` : ''}
              </td>
            </tr>`)}
        </tbody>
      </table>`;

    const cards: Safe = html`
      <ul class="cards collars-cards">
        ${list.map((c) => html`
          <li>
            <div class="card-row" style="flex-wrap:wrap;gap:0.75rem;">
              <span class="card-main">
                <a class="row-a font-mono num" href="/app/collars/${encodeURIComponent(c.deviceId)}" style="font-size:1.1rem;font-weight:700;">
                  ${c.code ?? c.deviceId}
                </a>
                <span class="caption muted">
                  ${c.animalId ? html`<a href="/app/herd/${c.animalId}">${c.animalName}</a>` : t('a.co.unassigned')} · ${rssi(c)} · ${timeEl(c.lastSeenAt)}
                </span>
              </span>
              <span class="card-side" style="display:flex;align-items:center;gap:0.5rem;">
                ${collarBadge(c)}
                ${c.animalId ? html`<a class="btn btn-secondary btn-sm" href="/app/herd/${c.animalId}">${t('a.co.toProfile')}</a>` : ''}
              </span>
            </div>
          </li>`)}
      </ul>`;

    listWrap.innerHTML = html`
      ${table}
      ${cards}
      <p class="caption muted rule">${t('a.co.offlineRule')}</p>
    `.s;

    listWrap.querySelectorAll<HTMLElement>('tr.row-link').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (!(e.target as Element).closest('a')) {
          ($('a', tr) as HTMLElement)?.click();
        }
      });
    });
  }

  void loadInto(listWrap, () => get<CollarDto[]>('/devices'), (list) => renderTableAndCards(list));

  // polling lives outside the render callback: it starts even if the first load failed, and is cleared on unmount
  let polling = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    if (!alive() || document.hidden || busy || polling) return;
    polling = true;
    try {
      const fresh = await get<CollarDto[]>('/devices');
      if (!alive() || busy) return;
      const hash = fresh.map((c) => `${c.deviceId}:${c.status}:${c.animalId}:${c.lastSeenAt}`).join('|');
      // also recovers a first load that failed (the error block is still on screen)
      if (hash !== lastListHash || listWrap.querySelector('.state-block.error')) renderTableAndCards(fresh);
    } catch { /* the shell banner reports the network state */ } finally { polling = false; }
  }, 5000);

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    stop();
  };
};
