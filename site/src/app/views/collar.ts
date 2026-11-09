import { $, html, setHtml } from '../../dom';
import { t } from '../../i18n';
import { navigate } from '../../router';
import type { AppView } from '../app';
import { ApiError, del, get, patch, post, type AnimalDto, type CollarDto } from '../api';
import { collarBadge, confirmDialog, errText, loadInto, offlineGuard, timeEl, toast } from '../common';
import { rssi } from './collars';
import { handOffSecret } from './connect';

export const mount: AppView['mount'] = (el, ctx) => {
  const id = ctx.params.deviceId;
  ctx.setTitle(id);
  ctx.setActions('');
  const stop = offlineGuard(document.body);
  const reload = () => void navigate(location.pathname, { replace: true });

  void loadInto(el, async () => {
    const [c, animals] = await Promise.all([get<CollarDto>(`/devices/${encodeURIComponent(id)}`), get<AnimalDto[]>('/animals?limit=100').catch(() => [] as AnimalDto[])]);
    return { c, animals };
  }, ({ c, animals }) => {
    const free = animals.filter((a) => !a.collarId);
    setHtml(el, html`
      <p><a href="/app/collars">${t('a.co.back')}</a></p>
      <div class="profile-head"><div>${collarBadge(c)}</div></div>
      <div class="grid-2">
        <section class="panel-block"><h2 class="title-2">${t('a.co.animal')}</h2>
          <p>${c.animalId ? html`<a href="/app/herd/${c.animalId}">${c.animalName}</a>` : t('a.co.unassigned')}</p>
          ${c.animalId
            ? html`<button type="button" class="btn btn-secondary btn-sm" id="unassign" data-write>${t('a.co.unassign')}</button>`
            : html`<div class="field"><label for="pick">${t('a.co.assign')}</label><select class="select" id="pick"><option value="">${t('a.co.pick')}</option>${free.map((a) => html`<option value="${a.id}">${a.name} · ${a.tag}</option>`)}</select></div><button type="button" class="btn btn-secondary btn-sm" id="assign" data-write>${t('a.co.save')}</button>`}</section>
        <section class="panel-block"><h2 class="title-2">${t('a.co.status')}</h2>
          <p>${t('a.co.seen')}: ${timeEl(c.lastSeenAt)}</p><p>${t('a.co.signal')}: <span class="num">${rssi(c)}</span></p>${c.firmwareVersion ? html`<p>${t('a.co.fw')}: ${c.firmwareVersion}</p>` : ''}
          <p class="caption muted">${t('a.co.offlineRule')}</p></section>
      </div>
      <section class="panel-block"><div class="row-actions">
        <button type="button" class="btn btn-secondary" id="t-spk" data-write>${t('a.co.testSpeaker')}</button>
        <button type="button" class="btn btn-secondary" id="t-buz" data-write>${t('a.co.testBuzzer')}</button>
        <button type="button" class="btn btn-secondary" id="t-vib" data-write>${t('a.co.testVib')}</button></div>
        <p class="muted" id="queued" role="status"></p></section>
      ${ctx.isOwner ? html`<section class="panel-block danger-zone"><div class="row-actions"><button type="button" class="btn btn-secondary" id="rotate" data-write>${t('a.co.rotate')}</button><button type="button" class="btn btn-danger" id="remove" data-write>${t('a.co.delete')}</button></div></section>` : ''}`);

    $('#unassign', el)?.addEventListener('click', async () => { try { await patch(`/devices/${encodeURIComponent(id)}`, { animalId: null }); reload(); } catch (e) { toast(errText(e)); } });
    $('#assign', el)?.addEventListener('click', async () => {
      const v = $<HTMLSelectElement>('#pick', el)!.value;
      if (!v) return;
      try { await patch(`/devices/${encodeURIComponent(id)}`, { animalId: v }); reload(); } catch (e) { toast(e instanceof ApiError && e.code === 'CONFLICT' ? e.message : errText(e)); }
    });
    const test = (signal: 'SPEAKER' | 'BUZZER' | 'VIBRATION') => async () => {
      try { await post(`/devices/${encodeURIComponent(id)}/test-signal`, { signal }); $('#queued', el)!.textContent = t('a.co.queued'); } catch (e) { toast(errText(e)); }
    };
    $('#t-spk', el)!.addEventListener('click', test('SPEAKER'));
    $('#t-buz', el)!.addEventListener('click', test('BUZZER'));
    $('#t-vib', el)!.addEventListener('click', test('VIBRATION'));
    $('#rotate', el)?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.co.rotateTitle'), text: t('a.co.rotateText'), confirmLabel: t('a.co.rotate'), danger: true, typeValue: id })) return;
      try {
        const r = await post<{ deviceSecret: string }>(`/devices/${encodeURIComponent(id)}/rotate-secret`);
        handOffSecret(id, r.deviceSecret);
        void navigate('/app/collars/connect');
      } catch (e) { toast(errText(e)); }
    });
    $('#remove', el)?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.co.deleteTitle', { id }), text: t('a.co.deleteText'), confirmLabel: t('a.co.delete'), danger: true, typeValue: id })) return;
      try { await del(`/devices/${encodeURIComponent(id)}`); void navigate('/app/collars', { replace: true }); } catch (e) { toast(errText(e)); }
    });
  });
  return stop;
};
