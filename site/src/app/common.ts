import { esc, html, raw, type Safe } from '../dom';
import { getLang, t } from '../i18n';
import { openModal } from '../ui/dialog';
import { icon } from '../ui/icons';
import { ApiError, type AnimalDto, type CollarControlMode, type CollarDto, type PulseThreatDto } from './api';
import { demoTag } from './demo';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return t('a.rel.never');
  const d = new Date(iso);
  const time = d.getTime();
  if (Number.isNaN(time)) return t('a.rel.never');
  const diff = (time - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return t('a.rel.now');
  const rtf = new Intl.RelativeTimeFormat(getLang() === 'kk' ? 'ru' : getLang(), { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
export function absTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(getLang() === 'kk' ? 'ru' : getLang(), { dateStyle: 'medium', timeStyle: 'short' });
}
export const timeEl = (iso: string | null | undefined): Safe => html`<time datetime="${iso ?? ''}" title="${absTime(iso)}">${timeAgo(iso)}</time>`;

export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.network) return navigator.onLine ? t('a.err.waking') : t('a.err.network');
    if (e.code === 'RATE_LIMITED') return t('a.err.rate');
    if (e.status >= 500) return t('a.err.server');
    return e.message || t('a.err.generic');
  }
  return t('a.err.generic');
}

export const skeleton = (rows = 4): Safe => html`<div class="skeleton-list" role="status" aria-label="${t('a.state.loading')}">${Array.from({ length: rows }, () => html`<div class="skeleton-row"></div>`)}</div>`;

export function emptyState(title: string, text?: string, action?: Safe): Safe {
  return html`<div class="state-block empty">${raw(icon('plant', 48, 'grass'))}<h2 class="title-2">${title}</h2>${text ? html`<p>${text}</p>` : ''}${action ?? ''}</div>`;
}

export function errorState(e: unknown, retryId = 'retry', backHref?: string, backLabel?: string): Safe {
  const is404 = e instanceof ApiError && (e.status === 404 || e.code === 'NOT_FOUND');
  const code = e instanceof ApiError ? e.code : 'ERROR';
  if (is404) {
    return html`<div class="state-block notfound" role="alert"><h2 class="title-2">${errText(e)}</h2><p class="muted">${t('a.state.errorHint')}</p><a class="btn btn-primary" href="${backHref || '/app/herd'}">${backLabel || t('a.state.toHerd')}</a></div>`;
  }
  return html`<div class="state-block error" role="alert"><h2 class="title-2">${t('a.state.error')}</h2><p>${errText(e)}. ${t('a.state.errorHint')}</p><button type="button" class="btn btn-primary" id="${retryId}">${t('a.state.retry')}</button><p class="caption muted">${t('a.state.code', { code })}</p></div>`;
}

export function forbiddenState(): Safe {
  return html`<div class="state-block"><h2 class="title-2">${t('a.state.forbidden')}</h2><a class="btn btn-secondary" href="/app/herd">${t('a.state.toHerd')}</a></div>`;
}

/** Status badge: 8 px dot + word, shape and text carry the meaning (app-design-brief 7.4). */
export function statusBadge(kind: 'online' | 'offline' | 'danger' | 'warning' | 'none' | 'ok', text: string): Safe {
  return html`<span class="badge badge-${kind}"><span class="dot" aria-hidden="true"></span>${text}</span>`;
}

export function animalBadge(a: AnimalDto): Safe {
  return html`${animalBadgeBase(a)}${demoTag(a.isDemo)}`;
}
function animalBadgeBase(a: AnimalDto): Safe {
  if (a.status === 'danger') return statusBadge('danger', t('a.st.danger'));
  if (a.status === 'offline') return statusBadge('offline', a.lastSeenAt ? t('a.st.offlineAt', { time: timeAgo(a.lastSeenAt) }) : t('a.st.offline'));
  if (a.status === 'warning') return statusBadge('warning', t('a.st.warning'));
  return a.collarId ? statusBadge('online', t('a.st.online')) : statusBadge('none', t('a.st.ok'));
}

export function pulseThreatBadge(pt?: PulseThreatDto | null): Safe {
  if (!pt || pt.level === 'UNKNOWN') return statusBadge('none', t('a.animal.noPulse'));
  const label = getLang() === 'en' ? pt.labelEn : getLang() === 'kk' ? pt.labelKk : pt.labelRu;
  const tip = pt.sourceNoteRu ? `${label} (${pt.source ?? 'Merck'}). ${pt.sourceNoteRu}` : `${label} (${pt.source ?? 'Merck'})`;
  if (pt.level === 'CRITICAL') {
    return html`<span class="badge badge-danger pulse-crit-badge" title="${tip}"><span class="dot" aria-hidden="true"></span>${label}</span>`;
  }
  if (pt.level === 'ELEVATED') {
    return html`<span class="badge badge-warning" title="${tip}"><span class="dot" aria-hidden="true"></span>${label}</span>`;
  }
  if (pt.level === 'LOW') {
    return html`<span class="badge badge-warning" title="${tip}"><span class="dot" aria-hidden="true"></span>${label}</span>`;
  }
  return html`<span class="badge badge-online" title="${tip}"><span class="dot" aria-hidden="true"></span>${label}</span>`;
}

/** Human label of a collar control mode (never the raw enum). */
export const controlModeLabel = (m: CollarControlMode): string => (m === 'GPS_MANUAL' ? t('a.animal.modeGpsManual') : m === 'MANUAL' ? t('a.animal.modeManual') : t('a.animal.modeAuto'));

export function collarBadge(c: CollarDto): Safe {
  return html`${collarBadgeBase(c)}${demoTag(c.isDemo)}`;
}
function collarBadgeBase(c: CollarDto): Safe {
  if (c.status === 'ONLINE') return statusBadge('online', t('a.st.online'));
  if (c.status === 'UNASSIGNED') return statusBadge('none', t('a.st.unassigned'));
  if (!c.lastSeenAt) return statusBadge('offline', t('a.st.never'));
  return statusBadge('offline', t('a.st.offlineAt', { time: timeAgo(c.lastSeenAt) }));
}

let toastTimer = 0;
export function toast(msg: string): void {
  const box = document.getElementById('toasts');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { box.classList.remove('on'); box.textContent = ''; }, 3500);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export interface ConfirmOpts { title: string; text: string; confirmLabel: string; danger?: boolean; typeValue?: string; cancelLabel?: string; cancelDefault?: boolean }

/** Modal confirmation: role=dialog, Esc, focus trap, focus return. Resolves true on confirm. */
export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const wrap = document.createElement('div');
    wrap.className = 'modal-scrim';
    wrap.hidden = true;
    wrap.innerHTML = html`
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-d">
        <h2 class="title-2" id="${id}-t">${o.title}</h2>
        <p id="${id}-d">${o.text}</p>
        ${o.typeValue ? html`<div class="field"><label for="${id}-i">${t('a.co.typeId', { id: o.typeValue })}</label><input class="input" id="${id}-i" autocomplete="off" autocapitalize="off" spellcheck="false"></div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">${o.cancelLabel ?? t('cancel')}</button>
          <button type="button" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" ${o.typeValue ? 'disabled' : ''}>${o.confirmLabel}</button>
        </div>
      </div>`.s;
    document.body.appendChild(wrap);
    const ok = wrap.querySelector<HTMLButtonElement>('[data-act="ok"]')!;
    const input = wrap.querySelector<HTMLInputElement>('input');
    input?.addEventListener('input', () => { ok.disabled = input.value.trim() !== o.typeValue; });
    let result = false;
    const handle = openModal(wrap, {
      opener: document.activeElement as HTMLElement | null,
      initialFocus: o.cancelDefault === false ? (input ?? ok) : wrap.querySelector<HTMLElement>('[data-act="cancel"]'),
      onClose: () => { wrap.remove(); resolve(result); },
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) handle.close(); });
    wrap.querySelector('[data-act="cancel"]')!.addEventListener('click', () => handle.close());
    ok.addEventListener('click', () => { result = true; handle.close(); });
  });
}

export const iconBtn = (name: string, label: string, cls = '', attrs = ''): Safe => html`<button type="button" class="icon-btn ${cls}" aria-label="${label}" title="${label}" ${raw(attrs)}>${raw(icon(name, 22))}</button>`;
export { esc };

/**
 * Standard page loading: skeleton (+ "slow" hint after 8 s), then render(data) or an error block with retry.
 * `alive` stops late responses from writing into a page the user has left.
 */
export async function loadInto<T>(el: HTMLElement, loader: () => Promise<T>, render: (d: T) => void, opts: { rows?: number; alive?: () => boolean; backHref?: string; backLabel?: string } = {}): Promise<void> {
  const alive = opts.alive ?? (() => el.isConnected);
  el.innerHTML = skeleton(opts.rows ?? 4).s;
  const slow = window.setTimeout(() => { if (alive()) el.insertAdjacentHTML('beforeend', `<p class="muted slow-hint" role="status">${esc(t('a.state.slow'))}</p>`); }, 8000);
  try {
    const d = await loader();
    window.clearTimeout(slow);
    if (!alive()) return;
    el.innerHTML = '';
    render(d);
  } catch (e) {
    console.error('loadInto failed:', e);
    window.clearTimeout(slow);
    if (!alive() || (e as Error).name === 'AbortError') return;
    el.innerHTML = errorState(e, 'retry', opts.backHref, opts.backLabel).s;
    el.querySelector('#retry')?.addEventListener('click', () => void loadInto(el, loader, render, opts));
  }
}

export const SPECIES = ['CATTLE', 'HORSE', 'CAMEL', 'SHEEP', 'GOAT'] as const;
export const speciesName = (s: string): string => t(`a.sp.${s}` as 'a.sp.CATTLE');

/** Write controls are disabled without a network connection, with the reason as the tooltip. */
export function offlineGuard(root: HTMLElement): () => void {
  const apply = () => root.querySelectorAll<HTMLButtonElement>('[data-write]').forEach((b) => {
    const off = document.body.classList.contains('is-offline');
    b.disabled = off; if (off) b.title = t('a.offline.disabled'); else b.removeAttribute('title');
  });
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

/** Runs a mutation with the button marked busy and disabled (no double submits); restores it afterwards, also on error. */
export async function withBusy(btn: Element | null | undefined, fn: () => Promise<void>): Promise<void> {
  const b = btn as HTMLButtonElement | null | undefined;
  if (!b) { await fn(); return; }
  if (b.getAttribute('aria-busy') === 'true') return;
  b.setAttribute('aria-busy', 'true');
  b.disabled = true;
  try { await fn(); } finally { if (b.isConnected) { b.removeAttribute('aria-busy'); b.disabled = false; } }
}
