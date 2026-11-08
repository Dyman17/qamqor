import { html, raw, setHtml } from './dom';
import { applyI18n, bindLangSwitch, langSwitcherHtml, t } from './i18n';
import type { View } from './router';

const view: View = {
  mount(root) {
    document.title = `${t('notfound.title')} | Qamqor`;
    root.className = 'page-center on-night';
    setHtml(root, html`
      <main id="main" class="notfound">
        <p class="notfound-brand">Qamqor</p>
        <h1 data-i18n="notfound.title"></h1>
        <p data-i18n="notfound.text"></p>
        <a class="btn btn-light" href="/" data-i18n="notfound.home"></a>
        ${raw(langSwitcherHtml('on-night'))}
      </main>`);
    bindLangSwitch(root);
    applyI18n(root);
  },
};
export const mount = view.mount;
