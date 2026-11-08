import '../styles/app.css';
import { $, html, raw, setHtml, type Safe } from '../dom';
import { applyI18n, bindLangSwitch, onLang, getLang, t } from '../i18n';
import { navigate, type RouteCtx, type View } from '../router';
import { icon } from '../ui/icons';
import { ApiError, getToken, post, setFarmId, setSession, type AuthResponse } from './api';
import { errText } from './common';

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const pwOk = (p: string): boolean => p.length >= 8 && new TextEncoder().encode(p).length <= 72 && p.length <= 72;

interface Field { id: string; label: string; type?: string; auto?: string; optional?: boolean; hint?: string; password?: boolean }

function fieldHtml(f: Field): Safe {
  const hintId = f.hint ? `${f.id}-hint` : '';
  const input = html`<input class="input" id="${f.id}" name="${f.id}" type="${f.type ?? 'text'}" autocomplete="${f.auto ?? 'off'}" ${f.optional ? '' : raw('required')} aria-describedby="${hintId} ${f.id}-err" ${f.type === 'email' ? raw('inputmode="email" autocapitalize="off" spellcheck="false"') : ''}>`;
  return html`
    <div class="field">
      <label for="${f.id}">${f.label}${f.optional ? html` <span class="opt">(${t('a.reg.optional')})</span>` : ''}</label>
      ${f.password
        ? html`<div class="pw-wrap">${input}<button type="button" class="pw-toggle" data-pw="${f.id}" aria-pressed="false" aria-controls="${f.id}">${t('a.login.show')}</button></div>`
        : input}
      ${f.hint ? html`<p class="hint" id="${hintId}">${f.hint}</p>` : ''}
      <p class="field-error" id="${f.id}-err" hidden></p>
    </div>`;
}

function layout(title: string, form: Safe, extra: Safe | string = ''): Safe {
  return html`
    <div class="auth">
      <aside class="auth-side on-night" aria-hidden="true">
        <img src="/posters/scene-1.webp" width="1280" height="960" alt="">
        <p class="auth-tag">${t('a.auth.tagline')}</p>
      </aside>
      <main id="main" class="auth-main">
        <div class="auth-top">
          <a class="brand-dark" href="/">Qamqor</a>
          <div class="lang-switch on-light" role="group" aria-label="${t('a.auth.lang')}">${(['kk', 'ru', 'en'] as const).map((l) => html`<button type="button" class="lang-btn" lang="${l}" data-set-lang="${l}" data-lang-current="${l}">${l.toUpperCase()}</button>`)}</div>
        </div>
        <div class="auth-card">
          <h1 class="display">${title}</h1>
          <div class="form-summary" id="summary" role="alert" hidden></div>
          ${form}
          ${extra}
        </div>
      </main>
    </div>`;
}

function setBusy(btn: HTMLButtonElement, busy: boolean, label: string, busyLabel: string): void {
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
  btn.innerHTML = busy ? `<span class="spinner" aria-hidden="true"></span>${busyLabel}` : label;
}

function showErrors(form: HTMLElement, errs: Record<string, string>, summary?: string): void {
  form.querySelectorAll<HTMLInputElement>('.input').forEach((i) => { i.removeAttribute('aria-invalid'); });
  form.querySelectorAll<HTMLElement>('.field-error').forEach((e) => { e.hidden = true; e.textContent = ''; });
  let first: HTMLInputElement | null = null;
  for (const [id, msg] of Object.entries(errs)) {
    const input = form.querySelector<HTMLInputElement>(`#${id}`);
    const err = form.querySelector<HTMLElement>(`#${id}-err`);
    if (!input || !err) continue;
    input.setAttribute('aria-invalid', 'true');
    err.innerHTML = `${icon('warning-circle', 18)}<span>${msg.replace(/</g, '&lt;')}</span>`;
    err.hidden = false;
    first ??= input;
  }
  const sum = document.getElementById('summary')!;
  const text = summary ?? (first ? t('a.err.summary') : '');
  sum.textContent = text;
  sum.hidden = !text;
  first?.focus();
}

function wirePw(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-pw]').forEach((b) => b.addEventListener('click', () => {
    const inp = root.querySelector<HTMLInputElement>(`#${b.dataset.pw}`)!;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.textContent = show ? t('a.login.hide') : t('a.login.show');
  }));
}

function safeNext(ctx: RouteCtx): string {
  const n = ctx.query.get('next');
  return n && /^\/app(\/|$|\?)/.test(n) ? n : '/app';
}

function finishAuth(r: AuthResponse, next: string): void {
  setSession(r.token);
  setFarmId(r.memberships[0]?.farmId ?? null);
  void navigate(next, { replace: true });
}

function loginView(ctx: RouteCtx): Safe {
  void ctx;
  return layout(t('a.login.title'), html`
    <form id="form" class="form" novalidate>
      ${fieldHtml({ id: 'email', label: t('a.login.email'), type: 'email', auto: 'email' })}
      ${fieldHtml({ id: 'password', label: t('a.login.password'), type: 'password', auto: 'current-password', password: true })}
      <button class="btn btn-primary btn-block" type="submit" id="submit">${t('a.login.submit')}</button>
    </form>`, html`<p class="auth-links"><a href="/forgot">${t('a.login.forgot')}</a><a href="/register">${t('a.login.create')}</a></p>`);
}

function registerView(): Safe {
  return layout(t('a.reg.title'), html`
    <form id="form" class="form" novalidate>
      ${fieldHtml({ id: 'fullName', label: t('a.reg.name'), auto: 'name' })}
      ${fieldHtml({ id: 'email', label: t('a.reg.email'), type: 'email', auto: 'email' })}
      ${fieldHtml({ id: 'phone', label: t('a.reg.phone'), type: 'tel', auto: 'tel', optional: true })}
      ${fieldHtml({ id: 'password', label: t('a.reg.password'), type: 'password', auto: 'new-password', password: true, hint: t('a.reg.pwHint') })}
      ${fieldHtml({ id: 'farmName', label: t('a.reg.farm'), optional: true, auto: 'organization' })}
      <button class="btn btn-primary btn-block" type="submit" id="submit">${t('a.reg.submit')}</button>
      <p class="caption muted">${t('a.reg.note')}</p>
    </form>`, html`<p class="auth-links"><a href="/login">${t('a.reg.haveAccount')}</a></p>`);
}

function forgotView(): Safe {
  return layout(t('a.forgot.title'), html`
    <form id="form" class="form" novalidate>
      ${fieldHtml({ id: 'email', label: t('a.login.email'), type: 'email', auto: 'email' })}
      <button class="btn btn-primary btn-block" type="submit" id="submit">${t('a.forgot.submit')}</button>
      <p class="form-ok" id="ok" role="status" hidden></p>
    </form>`, html`<p class="auth-links"><a href="/login">${t('a.login.submit')}</a></p>`);
}

function resetView(ctx: RouteCtx): Safe {
  if (!ctx.query.get('token')) return layout(t('a.reset.title'), html`<p role="alert" class="form-ok err">${t('a.reset.noToken')}</p>`, html`<p class="auth-links"><a href="/forgot">${t('a.forgot.title')}</a></p>`);
  return layout(t('a.reset.title'), html`
    <form id="form" class="form" novalidate>
      ${fieldHtml({ id: 'password', label: t('a.reset.password'), type: 'password', auto: 'new-password', password: true, hint: t('a.reg.pwHint') })}
      <button class="btn btn-primary btn-block" type="submit" id="submit">${t('a.reset.submit')}</button>
      <p class="form-ok" id="ok" role="status" hidden></p>
    </form>`);
}

function inviteView(ctx: RouteCtx): Safe {
  if (!ctx.query.get('token')) return layout(t('a.invite.title'), html`<p role="alert" class="form-ok err">${t('a.invite.noToken')}</p>`);
  const known = Boolean(getToken());
  return layout(t('a.invite.title'), html`
    <form id="form" class="form" novalidate>
      ${known ? '' : html`<p class="muted">${t('a.invite.needData')}</p>${fieldHtml({ id: 'fullName', label: t('a.invite.name'), auto: 'name', optional: true })}${fieldHtml({ id: 'password', label: t('a.invite.password'), type: 'password', auto: 'new-password', password: true, optional: true, hint: t('a.reg.pwHint') })}`}
      <button class="btn btn-primary btn-block" type="submit" id="submit">${t('a.invite.accept')}</button>
    </form>`, known ? '' : html`<p class="auth-links"><a href="/login?next=/app">${t('a.login.submit')}</a></p>`);
}

function apiMessage(e: unknown, kind: 'login' | 'register' | 'other'): string {
  if (e instanceof ApiError) {
    if (kind === 'login' && e.status === 401) return t('a.err.badCreds');
    if (kind === 'register' && e.status === 409) return t('a.err.emailTaken');
  }
  return errText(e);
}

const view: View = {
  mount(root, ctx) {
    root.className = 'auth-root';
    if (getToken() && (ctx.path === '/login' || ctx.path === '/register')) { void navigate('/app', { replace: true }); return; }
    const page = ctx.path.slice(1);
    const titles: Record<string, string> = { login: t('a.login.title'), register: t('a.reg.title'), forgot: t('a.forgot.title'), reset: t('a.reset.title'), invite: t('a.invite.title') };
    document.title = `${titles[page] ?? 'Qamqor'} | Qamqor`;
    const body = { login: loginView, register: registerView, forgot: forgotView, reset: resetView, invite: inviteView }[page as 'login']?.(ctx) ?? loginView(ctx);
    setHtml(root, html`<a class="skip-link" href="#main">${t('a.skip')}</a>${body}`);
    applyI18n(root);
    bindLangSwitch(root);
    root.querySelectorAll<HTMLElement>('[data-lang-current]').forEach((n) => { n.setAttribute('aria-pressed', String(n.dataset.langCurrent === getLang())); });
    wirePw(root);
    const off = onLang(() => { void navigate(location.pathname + location.search, { replace: true }); });
    const form = $<HTMLFormElement>('#form', root);
    const submit = $<HTMLButtonElement>('#submit', root);
    if (!form || !submit) return off;
    const label = submit.innerHTML;
    const busyLabel = page === 'login' ? t('a.login.busy') : page === 'register' ? t('a.reg.busy') : t('a.state.loading');
    const val = (id: string) => ($<HTMLInputElement>(`#${id}`, form)?.value ?? '').trim();
    const raw_ = (id: string) => $<HTMLInputElement>(`#${id}`, form)?.value ?? '';
    let busy = false;

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      const errs: Record<string, string> = {};
      if (page === 'login' || page === 'register' || page === 'forgot') if (!MAIL.test(val('email'))) errs.email = t('a.err.email');
      if (page === 'register' && !val('fullName')) errs.fullName = t('a.err.name');
      if (page === 'login' && !raw_('password')) errs.password = t('a.err.required');
      if ((page === 'register' || page === 'reset') && !pwOk(raw_('password'))) errs.password = t('a.err.pw');
      if (page === 'invite' && raw_('password') && !pwOk(raw_('password'))) errs.password = t('a.err.pw');
      if (Object.keys(errs).length) { showErrors(form, errs); return; }
      showErrors(form, {});
      busy = true;
      setBusy(submit, true, label, busyLabel);
      try {
        if (page === 'login') {
          const r = await post<AuthResponse>('/auth/login', { email: val('email'), password: raw_('password') }, { auth: false, farm: false });
          finishAuth(r, safeNext(ctx));
        } else if (page === 'register') {
          const body: Record<string, string> = { email: val('email'), password: raw_('password'), fullName: val('fullName') };
          if (val('phone')) body.phone = val('phone');
          if (val('farmName')) body.farmName = val('farmName');
          const r = await post<AuthResponse>('/auth/register', body, { auth: false, farm: false });
          finishAuth(r, '/app');
        } else if (page === 'forgot') {
          await post('/auth/password-reset/request', { email: val('email'), lang: getLang() }, { auth: false, farm: false });
          const ok = $('#ok', form)!; ok.textContent = t('a.forgot.ok'); ok.hidden = false;
        } else if (page === 'reset') {
          await post('/auth/password-reset/confirm', { token: ctx.query.get('token'), newPassword: raw_('password') }, { auth: false, farm: false });
          const ok = $('#ok', form)!; ok.textContent = t('a.reset.ok'); ok.hidden = false;
          setTimeout(() => void navigate('/login'), 1800);
        } else if (page === 'invite') {
          const body: Record<string, string> = { token: ctx.query.get('token')! };
          if (val('fullName')) body.fullName = val('fullName');
          if (raw_('password')) body.password = raw_('password');
          const r = await post<AuthResponse>('/auth/invitations/accept', body, { farm: false });
          finishAuth(r, '/app');
        }
      } catch (e) {
        if (page === 'forgot' && e instanceof ApiError && e.code === 'MAIL_NOT_CONFIGURED') showErrors(form, {}, t('a.forgot.nomail'));
        else if ((page === 'reset' || page === 'invite') && e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 401 || e.status === 409)) showErrors(form, {}, page === 'reset' ? t('a.reset.bad') : (e.message || t('a.invite.bad')));
        else if (page === 'login' && e instanceof ApiError && e.status === 401) showErrors(form, { password: t('a.err.badCreds') }, t('a.err.badCreds'));
        else if (page === 'register' && e instanceof ApiError && e.status === 409) showErrors(form, { email: t('a.err.emailTaken') });
        else showErrors(form, {}, apiMessage(e, page === 'login' ? 'login' : page === 'register' ? 'register' : 'other'));
      } finally {
        busy = false;
        if (document.body.contains(submit)) setBusy(submit, false, label, busyLabel);
      }
    });
    return off;
  },
};

export const mount = view.mount;
