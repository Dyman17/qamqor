import { en, kk, ru, type Key } from './locales';
import { lsGet, lsSet } from './storage';

export type Lang = 'ru' | 'kk' | 'en';
export const LANGS: Lang[] = ['ru', 'kk', 'en'];
export type { Key };

const dicts: Record<Lang, Record<string, string>> = { ru, kk, en };
const KEY = 'qamqor.lang';
const listeners = new Set<(l: Lang) => void>();

function detect(): Lang {
  const saved = lsGet(KEY);
  if (saved === 'ru' || saved === 'kk' || saved === 'en') return saved;
  for (const raw of navigator.languages ?? [navigator.language]) {
    const l = (raw || '').slice(0, 2).toLowerCase();
    if (l === 'kk' || l === 'ru' || l === 'en') return l;
  }
  return 'ru';
}

let lang: Lang = detect();

export function getLang(): Lang { return lang; }

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  lsSet(KEY, l);
  document.documentElement.lang = l;
  applyI18n(document);
  listeners.forEach((cb) => cb(l));
}

export function onLang(cb: (l: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key: Key, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Keys are plain strings in data-i18n attributes, so the lookup is by string. */
export function tk(key: string): string {
  return dicts[lang][key] ?? ru[key as Key] ?? key;
}

/**
 * Static text is filled from attributes: data-i18n (textContent), data-i18n-aria (aria-label),
 * data-i18n-title (title), data-i18n-placeholder. Keeps the language switch free of re-renders.
 */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((n) => { n.textContent = tk(n.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((n) => n.setAttribute('aria-label', tk(n.dataset.i18nAria!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((n) => n.setAttribute('title', tk(n.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((n) => n.setAttribute('placeholder', tk(n.dataset.i18nPlaceholder!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-alt]').forEach((n) => n.setAttribute('alt', tk(n.dataset.i18nAlt!)));
  root.querySelectorAll<HTMLElement>('[data-lang-current]').forEach((n) => {
    n.setAttribute('aria-current', n.dataset.langCurrent === lang ? 'true' : 'false');
    n.setAttribute('aria-pressed', n.dataset.langCurrent === lang ? 'true' : 'false');
  });
}

export function initI18n(): void {
  document.documentElement.lang = lang;
}

/** Language switcher markup: real buttons with lang attributes (site-brief 5.3). */
export function langSwitcherHtml(cls = ''): string {
  return `<div class="lang-switch ${cls}" role="group" data-i18n-aria="lang.label" aria-label="${tk('lang.label')}">${LANGS.map(
    (l) => `<button type="button" class="lang-btn" lang="${l}" data-set-lang="${l}" data-lang-current="${l}" data-i18n="lang.${l}">${l.toUpperCase()}</button>`,
  ).join('')}</div>`;
}

/** Wire all [data-set-lang] buttons under root. Call once per mounted view. */
export function bindLangSwitch(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-set-lang]').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.setLang as Lang));
  });
}
