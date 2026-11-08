import { html, type Safe } from '../dom';
import { t } from '../i18n';
import { openModal } from '../ui/dialog';
import { errText } from './common';

/** Form in a modal dialog. onSubmit returns an error message to show, or nothing to close the dialog. */
export function formModal(o: { title: string; body: Safe; submitLabel: string; onSubmit: (form: HTMLFormElement) => Promise<string | void> }): void {
  const id = `fm-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = document.createElement('div');
  wrap.className = 'modal-scrim';
  wrap.hidden = true;
  wrap.innerHTML = html`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
    <h2 class="title-2" id="${id}-t">${o.title}</h2>
    <form class="form" novalidate>${o.body}<p class="field-error" role="alert" data-err hidden></p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" data-act="cancel">${t('cancel')}</button><button type="submit" class="btn btn-primary" data-write>${o.submitLabel}</button></div>
    </form></div>`.s;
  document.body.appendChild(wrap);
  const form = wrap.querySelector('form')!;
  const handle = openModal(wrap, { opener: document.activeElement as HTMLElement | null, onClose: () => wrap.remove() });
  wrap.querySelector('[data-act="cancel"]')!.addEventListener('click', () => handle.close());
  wrap.addEventListener('click', (e) => { if (e.target === wrap) handle.close(); });
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const err = form.querySelector<HTMLElement>('[data-err]')!;
    err.hidden = true;
    const btn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      const msg = await o.onSubmit(form);
      if (msg) { err.textContent = msg; err.hidden = false; } else handle.close();
    } catch (er) { err.textContent = errText(er); err.hidden = false; }
    finally { busy = false; btn.removeAttribute('aria-busy'); btn.disabled = false; }
  });
}
