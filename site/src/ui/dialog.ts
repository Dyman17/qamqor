/** Modal helper: focus moves in, Tab is trapped, Esc closes, focus returns to the opener (site-brief 5.3, CLAUDE.md 6). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle { close(): void; }

export function openModal(modal: HTMLElement, opts: { opener?: HTMLElement | null; onClose?: () => void; initialFocus?: HTMLElement | null } = {}): DialogHandle {
  const opener = opts.opener ?? (document.activeElement as HTMLElement | null);
  modal.hidden = false;
  const items = () => Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => !e.hidden && e.offsetParent !== null);
  const first = opts.initialFocus ?? items()[0];
  first?.focus();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const list = items();
    if (!list.length) { e.preventDefault(); return; }
    const a = list[0], z = list[list.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    else if (!modal.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    modal.hidden = true;
    opener?.focus();
    opts.onClose?.();
  }
  return { close };
}
