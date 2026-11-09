import { $, html, raw, setHtml } from '../../dom';
import { t } from '../../i18n';
import { navigate } from '../../router';
import type { AppCtx, AppView } from '../app';
import { ApiError, del, get, patch, post, type AlertDto, type AnimalDto, type CollarDto, type EventsDto, type PenDto } from '../api';
import { animalBadge, confirmDialog, loadInto, offlineGuard, SPECIES, speciesName, timeEl, toast } from '../common';
import { formModal } from '../forms';

/** Create or edit an animal in a modal form (POST /animals, PATCH /animals/:id). */
export async function openAnimalForm(ctx: AppCtx, animal: AnimalDto | undefined, onSaved: () => void): Promise<void> {
  let pens: PenDto[] = [];
  let collars: CollarDto[] = [];
  try { [pens, collars] = await Promise.all([get<PenDto[]>('/geofences'), get<CollarDto[]>('/devices')]); } catch { /* the selects stay empty */ }
  const free = collars.filter((c) => !c.animalId || c.deviceId === animal?.collarId);
  void ctx;
  formModal({
    title: animal ? t('a.animal.editTitle') : t('a.animal.new'),
    submitLabel: t('a.animal.save'),
    body: html`
      <div class="field"><label for="af-name">${t('a.animal.f.name')}</label><input class="input" id="af-name" name="name" required value="${animal?.name ?? ''}" autocomplete="off"></div>
      <div class="field"><label for="af-tag">${t('a.animal.f.tag')}</label><input class="input" id="af-tag" name="tag" required value="${animal?.tag ?? ''}" autocomplete="off"></div>
      <div class="field"><label for="af-sp">${t('a.animal.f.species')}</label><select class="select" id="af-sp" name="species">${SPECIES.map((s) => html`<option value="${s}" ${animal?.species === s ? raw('selected') : ''}>${speciesName(s)}</option>`)}</select></div>
      <div class="field"><label for="af-pen">${t('a.animal.f.pen')}</label><select class="select" id="af-pen" name="penId"><option value="">${t('a.animal.f.none')}</option>${pens.map((p) => html`<option value="${p.id}" ${animal?.penId === p.id ? raw('selected') : ''}>${p.name}</option>`)}</select></div>
      <div class="field"><label for="af-col">${t('a.animal.f.collar')}</label><select class="select" id="af-col" name="collarId"><option value="">${t('a.animal.f.none')}</option>${free.map((c) => html`<option value="${c.deviceId}" ${animal?.collarId === c.deviceId ? raw('selected') : ''}>${c.deviceId}</option>`)}</select></div>`,
    async onSubmit(form) {
      const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
      if (!v('name') || !v('tag')) return t('a.err.required');
      try {
        if (!animal) {
          const body: Record<string, string> = { name: v('name'), tag: v('tag'), species: v('species') };
          if (v('penId')) body.penId = v('penId');
          if (v('collarId')) body.collarId = v('collarId');
          await post<AnimalDto>('/animals', body);
        } else {
          const body: Record<string, string | null> = {};
          if (v('name') !== animal.name) body.name = v('name');
          if (v('tag') !== animal.tag) body.tag = v('tag');
          if (v('species') !== animal.species) body.species = v('species');
          if ((v('penId') || null) !== animal.penId) body.penId = v('penId') || null;
          if ((v('collarId') || null) !== animal.collarId && v('collarId')) body.collarId = v('collarId');
          if (Object.keys(body).length) await patch<AnimalDto>(`/animals/${animal.id}`, body);
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFLICT') return t('a.animal.tagTaken');
        throw e;
      }
      onSaved();
    },
  });
}

const alertLabel = (a: AlertDto) => t(`a.al.t.${a.type}` as 'a.al.t.GPS_LOST');

export const mount: AppView['mount'] = (el, ctx) => {
  ctx.setTitle(t('a.animal.title'));
  ctx.setActions('');
  const stop = offlineGuard(document.body);
  const id = ctx.params.id;
  const alive = () => el.isConnected;
  void loadInto(el, async () => {
    const [animal, ev, pens] = await Promise.all([get<AnimalDto>(`/animals/${id}`), get<EventsDto>(`/animals/${id}/events`).catch(() => null), get<PenDto[]>('/geofences').catch(() => [] as PenDto[])]);
    return { animal, ev, pens };
  }, ({ animal: a, ev, pens }) => {
    ctx.setTitle(`${a.name} · ${a.tag}`);
    ctx.setActions(html`<button type="button" class="btn btn-secondary btn-sm" id="edit" data-write>${t('a.animal.edit')}</button><button type="button" class="btn btn-danger btn-sm" id="remove" data-write>${t('a.animal.delete')}</button>`);
    const pen = pens.find((p) => p.id === a.penId);
    const sig = ev?.signals;
    const lim = (l: number | null) => (l == null ? t('a.animal.noLimit') : t('a.animal.limit', { n: l }));
    setHtml(el, html`
      <p><a href="/app/herd">${t('a.animal.back')}</a></p>
      <div class="profile-head"><div>${animalBadge(a)}</div><a class="btn btn-primary btn-sm" href="/app/map?animal=${a.id}">${t('a.map.showOnMap')}</a></div>
      <div class="grid-2">
        <section class="panel-block" aria-labelledby="h-pos"><h2 class="title-2" id="h-pos">${t('a.animal.position')}</h2>
          <p class="num">${a.lat != null && a.lng != null ? t('a.animal.coords', { lat: a.lat.toFixed(5), lng: a.lng.toFixed(5) }) : '—'}</p>
          <p class="muted">${t('a.animal.accuracy')}: ${a.accuracyM != null ? `${Math.round(a.accuracyM)} m` : '—'} · ${timeEl(a.lastSeenAt)}</p></section>
        <section class="panel-block" aria-labelledby="h-col"><h2 class="title-2" id="h-col">${t('a.animal.collar')}</h2>
          <p>${a.collarId ? html`<a href="/app/collars/${a.collarId}">${a.collarId}</a>` : t('a.herd.noCollar')}</p>
          ${a.collarId ? html`<button type="button" class="btn btn-secondary btn-sm" id="unlink" data-write>${t('a.animal.unlink')}</button>` : ''}</section>
        <section class="panel-block" aria-labelledby="h-pulse"><h2 class="title-2" id="h-pulse">${t('a.animal.pulse')}</h2>
          <p class="num">${a.lastHeartRate != null ? t('a.animal.bpm', { n: a.lastHeartRate }) : '—'}</p>
          <p class="muted">${a.lastHeartRateAt ? timeEl(a.lastHeartRateAt) : t('a.animal.noPulse')}</p></section>
        <section class="panel-block" aria-labelledby="h-pen"><h2 class="title-2" id="h-pen">${t('a.animal.pen')}</h2><p>${pen?.name ?? t('a.herd.noPen')}</p></section>
        <section class="panel-block" aria-labelledby="h-sig"><h2 class="title-2" id="h-sig">${t('a.animal.signals')}</h2>
          ${sig ? html`<p>${t('a.animal.sound')}: <strong class="num">${sig.sound.used}</strong> (${lim(sig.sound.limit)})</p><p>${t('a.animal.vibration')}: <strong class="num">${sig.vibration.used}</strong> (${lim(sig.vibration.limit)})</p>` : html`<p>—</p>`}</section>
      </div>
      <section class="panel-block" aria-labelledby="h-ev"><h2 class="title-2" id="h-ev">${t('a.animal.events')}</h2>
        ${ev?.alerts.length ? html`<ul class="events">${ev.alerts.map((x) => html`<li><strong>${alertLabel(x)}</strong><span class="muted">${x.message}</span>${timeEl(x.createdAt)}</li>`)}</ul>` : html`<p class="muted">${t('a.animal.noEvents')}</p>`}</section>`);
    $('#edit')!.addEventListener('click', () => void openAnimalForm(ctx, a, () => void navigate(location.pathname, { replace: true })));
    $('#remove')!.addEventListener('click', async () => {
      if (!await confirmDialog({ title: t('a.animal.deleteTitle'), text: t('a.animal.deleteText', { name: a.name }), confirmLabel: t('a.animal.delete'), danger: true })) return;
      try { await del(`/animals/${a.id}`); void navigate('/app/herd', { replace: true }); } catch (e) { toast((e as Error).message); }
    });
    $('#unlink', el)?.addEventListener('click', async () => {
      try { await post(`/animals/${a.id}/unassign-collar`); void navigate(location.pathname, { replace: true }); } catch (e) { toast((e as Error).message); }
    });
  }, { alive });
  return stop;
};
