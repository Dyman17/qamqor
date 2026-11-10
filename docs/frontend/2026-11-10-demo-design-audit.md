Status: draft

# Demo design audit (dashboard, pre-demo)

Date: 2026-11-10. Scope: web dashboard in `site/` (map, herd, animal, collars, collar, connect, alerts, settings, shell). Direction: A3 "Горизонт современный" (light cabinet, green sidebar). No new features; every item is a CSS/markup/i18n fix.

Method and limits (be honest):
- Reviewed from existing screenshots in `site/qa-screenshots/` (8) and `site/qa-deep-screenshots/` (27: desktop 1280x800 and mobile 390x844), plus reading `tokens.css`, `ui.css`, `app.css`, `base.css` and views. No dev server was running, so nothing was re-rendered.
- Not visually audited: the landing page (no screenshots, server down), 320/768/1440 widths, kk/en languages, forced-colors. The landing CSS was only grepped for raw colours (`#fff/#000` print block, `#123826` dot field, a few rgba gradients; acceptable as effects, but they are raw values outside tokens).
- map.ts and animal.ts GPS-manual marker flow is ignored as instructed (but their static markup issues are listed).
- Contrast was computed numerically (WCAG relative luminance). Results are in section 5. Nearly every proposed token pair passes; the real contrast risks are the hard-coded Tailwind-like colours listed in P1.

---

## P0 - embarrassing in the demo

### P0-1. Mobile top bar breaks page titles letter by letter and eats ~130px
Screens: mobile Стадо ("Стад / о"), Ошейники ("Оше / йник / и"), Оповещения ("Оповещ / ения"), animal detail (title in 3 lines), connect. See `mobile_herd.png`, `mobile_collars.png`, `mobile_alerts.png`, `mobile_animal_detail.png`.
Cause: `app.css:~81 .chrome` is a single flex row; `.chrome h1` has `overflow-wrap: anywhere` (line ~82), and `.chrome-right` (conn "1/2" + page actions + settings icon) is `flex-wrap: wrap` and wins the width. Violates CLAUDE.md 6 (no letter-by-letter breaks).
Fix (CSS only), in `@media (max-width: 767px)`:
- `.chrome { flex-wrap: wrap; row-gap: var(--space-2); padding: 8px 12px 8px 16px; }`
- `.chrome h1 { flex: 1 1 0; min-width: 0; overflow-wrap: normal; word-break: normal; hyphens: auto; font-size: 22px; line-height: 28px; letter-spacing: -.03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` (titles are 1 word on every top-level page; the animal title "Esp32 (Акбас) · 12345678" ellipsises, full name is repeated in the page heading below).
- `.chrome-right { flex-wrap: nowrap; flex: none; }`
- `.page-actions { order: 3; flex: 1 1 100%; }` and `.page-actions .btn { flex: 1 1 0; }` so "Добавить животное", "Изменить/Удалить", "Отметить все прочитанными" drop to a second row inside the pill instead of squeezing the title. Result: bar height 64px (no actions) or ~116px (actions) instead of 130-200px.
- `.chrome h1` is read by `ctx.setTitle`; remove `overflow-wrap: anywhere` from the desktop rule too, replace by `overflow-wrap: break-word`.

### P0-2. Demo strip pushes the sidebar off-screen (logout cut off) and uses a "debug" dashed look
Screen: desktop with demo strip (`qa-screenshots/03b_desktop_animal_profile.png`): sidebar starts at y=40 but keeps `height: 100svh`, so "Выйти" is cropped at the bottom; mobile `05_mobile_map_drawing_bar.png`: strip wraps to two lines with an orphan "·".
Where: `app.css` `.side` (`height: 100svh; top: 0`) vs `.demo-strip` (min-height 40px, `border-bottom: 2px dashed var(--mint)`), `.demo-strip-tag` (dashed border).
Fix:
- Put the strip in a CSS var: `.demo-strip { --strip-h: 40px; position: sticky; top: 0; z-index: 41; }`, and `.side { top: var(--strip-h-live, 0px); height: calc(100svh - var(--strip-h-live, 0px)); }` where `--strip-h-live` is set on `.app-root` to `40px` when the strip is visible (one `classList` toggle in app.ts at the same place that un-hides it; no new feature). Same for `.map-wrap` (`height: calc(100svh - 76px - var(--strip-h-live, 0px))`) and `.chrome` (`top: calc(12px + var(--strip-h-live, 0px))`).
- Replace dashes with a solid look: `.demo-strip { border-bottom: 1px solid var(--edge); }`, `.demo-strip-tag { border: 0; background: var(--night-2); color: var(--mint); padding: 2px 10px; border-radius: var(--r-chip); font-weight: 700; }`. Drop the bare "·" separator (`app.ts:215` `<span aria-hidden>·</span>`) via `@media (max-width: 767px) { .demo-strip [aria-hidden="true"] { display: none; } .demo-strip { font-size: 14px; line-height: 20px; } }`.
- Same treatment for `.demo-tag` (`app.css:~300`): `border: 0; background: var(--surface-1); color: var(--ink-2); border-radius: var(--r-chip); padding: 0 8px; font-size: 12px; line-height: 20px;`. Dashed outlines everywhere read as wireframe/debug, not as a deliberate "simulation" mark. (Keep the dashed `.amark.demo` outline on the map: it is the one place where shape must differ for non-colour identification; contrast of the casing is unchanged.)

### P0-3. Raw enums and English/Latin strings in the Russian UI
All visible on the animal page, which is the demo's centrepiece (`desktop_animal_detail.png`):
| Shown | Source | Fix |
|---|---|---|
| "ONLINE" / "OFFLINE" next to collar id | `animal.ts:186` and `:203` print `${collar.status}` | use `collarBadge(collar)` from `common.ts:93` (already localised: "На связи"/"Нет связи") |
| "GREEN · Безопасный выпас (сигналов нет)" | `animal.ts:117-124` zone label prefix | drop the `GREEN`/`YELLOW`/`RED`/`ESCAPE` prefix in `locales/app.ts` (`a.animal.zone*`, line ~111 "ESCAPE · Побег (...)"): show only the Russian phrase; colour + icon already carry the level |
| "Точность: 4 m" | `animal.ts:184` and `:306` hard-code ` m` | `t('a.units.m', {n})` -> ru "4 м", kk "4 м", en "4 m" |
| "Автовозврат в режим AUTO через 1 ч 59 мин" | `locales/app.ts:89` | "...в автоматический режим через..." (en: "back to Automatic mode") |
| "Режим ошейника изменен на {mode}" | `app.ts` toast, `a.animal.modeChanged` | `{mode}` must be the localised label, not the enum; also "изменён" with ё like the rest of the copy |
| "(модель Halter)" in auto-mode hint | `locales/app.ts:86` | remove the third-party brand: "ошейник сам удерживает животное в пастбище". Also CLAUDE.md: no other company's branding/copy |
| "Merck Veterinary Manual (Physiologic Constants: Cattle)" in the white chip | `pulse-source-tag` / `pt.source` from server | keep source text but clamp: see P1-6 |
| Hard-coded Russian outside i18n: "Острый стресс / угроза хищника или бегство! Проверьте животное на пастбище!" (`animal.ts:112`), "Физиологические показатели покоя (Merck Veterinary Manual)." (`:97`), "(допущение)" (`:108`), "Удалить загон" title (`map.ts:196`) | move to `locales/app.ts` (ru/kk/en) so kk and en do not show Russian. Also `title="Server-Sent Events active"` (`animal.ts:~155`) is English debug text: use `t('a.animal.streamLive')` |
| Mode tabs "Автоматический (Геозона)" / "GPS вручную (Перетаскивание)" / "Ручной (Оператор)" | `locales/app.ts:83-85` | tabs are too long (3 tabs ~830px) and the parentheses read like dev notes. Use short labels: "Авто", "GPS вручную", "Ручной"; move the parenthetical to the hint line below (already exists) |

### P0-4. "Обновить ключ" button is invisible on the collar page
Screen: `desktop_collar_detail.png`, `mobile_collar_detail.png` bottom card. `.danger-zone { background: var(--surface-1) }` and `.btn-secondary { background: var(--surface-1) }` are the same colour, so the secondary button is bare text next to a red "Удалить".
Fix: `.danger-zone { background: var(--surface-2); border: 1px solid var(--signal); }` and `.danger-zone .btn-secondary { background: var(--surface-1); }`. Add a heading to the card (`<h2 class="title-2">` using an existing "danger"/"Опасная зона" string) so a red button is not the first thing in an unlabelled box. Same unlabelled-card issue for the three test buttons ("Левый динамик / Правый зуммер / Вибрация"): give the card a `title-2` "Проверка сигналов" (reuse key if one exists; else it is a string, not a feature).

### P0-5. Draw bar floats over the sidebar and over the map controls; on mobile it covers the sheet
- Desktop: `app.css .draw-bar { left: calc(50% - 180px); transform: translateX(-50%) }` is centred on the map area minus a magic 180px, but the bar is ~720px wide (nowrap), so its left edge lands at x~222 and covers the sidebar (see `desktop_draw_modal.png`: "Рисование загона" sits on top of the green nav). Fix: `left: calc(var(--space-6) + 48px + var(--space-4)); right: calc(360px + var(--space-6) + var(--space-4)); transform: none; width: fit-content; max-width: calc(100% - 520px);` (clears controls column at left 20+48 and the 360px panel at right 20) and `top: 76px` (same as panel/live-alert) instead of 88.
- Mobile (`mobile_draw_modal.png`): bar at `top: 84px` overlaps the zoom buttons column (left 12, width 48) and, with the sheet open, collides with the sheet edge. Fix: while drawing hide the controls column except the active pencil: `@media (max-width: 767px) { .map-wrap:has(.draw-bar:not([hidden])) .map-controls .map-btn:not(.active) { display: none; } }`, and keep the bar at `top: 76px`. The sheet in drawing state should be at its 204px peek height; do not render "Назад к списку" + full profile under the bar.
- The three overlays share `top` 76/84/88px and `z-index` 5/6/25/1000: standardise on tokens (`--map-top: 76px`; z: controls 5, panel 6, bar 25, live-alert 26 not 1000; modal scrim already 100).

---

## P1 - noticeable

### P1-1. Herd table wraps cells at 1280px, status badge in two lines
`desktop_herd.png`: "Без границы", "только что", "На связи" badge and "Корова" wrap to two lines; header "Был(а) на связи" wraps; rows are uneven (64px min but 2-line content). Cause: 8 columns in 992px, no nowrap, `.table td { padding: 0 16px }`.
Fix: `.table td, .table th { padding: 0 12px; }`, `.table td .badge, .table td time, .table td:nth-child(n+4) { white-space: nowrap; }`, `.table th { white-space: nowrap; }`, name column `min-width: 160px`. Rename column "Был(а) на связи" to "Связь" or use existing short key "Последний сигнал" (gendered "Был(а)" reads as unfinished). Hide the duplicate "Ошейник" column value when it equals the tag (data: both "12345678") only if the product allows; otherwise leave.
Also `.badge` in the same table has `padding: 2px 8px` (looks cramped vs 28px chips): see P2-4.

### P1-2. Alert nav badge says 2, list says "Оповещений нет"
`desktop_alerts.png`: orange badge "2" on the Оповещения nav item while the "Активные" tab shows the empty state. Either the screenshot was taken mid-refresh or the stats endpoint and list disagree. Verify with a live run before the demo; if it reproduces, the badge must use the same filter (`status=ACTIVE`) as the list. Cosmetic part: the empty state block is a 560px left-aligned tile with a 72px leaf in an otherwise empty page; reduce to icon 48px (`icon('plant', 48)`), `padding: var(--space-6)`, and text "Оповещений нет. Всё спокойно" stays. Not centred-hero, keep left aligned but full list width.

### P1-3. Hard-coded Tailwind-style colours and inline styles bypass tokens
Raw values (CLAUDE.md 6: no raw colours where a token exists):
- `app.css` Phase 3b block: `.pulse-crit-badge` `#b91c1c / #fee2e2 / #fca5a5 / #dc2626 / #ef4444`; `.pulse-source-tag.is-assumption` `#b45309 / #fde68a / #fef3c7`; `.map-live-alert` `#fff / #991b1b / #f87171 / rgba(220,38,38,.2)`; `.draw-vertex` `#fff`, `rgba(0,0,0,.35)`; `.map-btn.active` `#fff` and `rgba(16,185,129,.35)` (this emerald is not in the palette; map.ts:365/521 also fall back to `#10B981`).
- `animal.ts:104,112,130,297,377,389`, `map.ts:196,499`, `settings.ts:168,192`: inline `#fca5a5 #fff5f5 #fed7aa #fffaf0 #991b1b #fee2e2 #dc2626 #fff`, and fallbacks like `var(--ok, #16a34a)`.
Fix: map to existing tokens. Critical/danger surface: `background: var(--surface-1)`? Better add no new colours: badge-danger already exists (`color: var(--signal); background: rgba(181,44,8,.08)`). Use `.badge-danger` for `pulse-crit-badge` and `zoneEscape`; keep the glow via `box-shadow: 0 0 0 4px rgba(181,44,8,.18)` in the keyframe. Warning surfaces: `.badge-warning` (`--warning #7A4A00`). `.map-live-alert`: `background: var(--surface-2-white); color: var(--signal); border: 1.5px solid var(--signal); box-shadow: var(--glass-light-shadow)`. `on-primary` replaces every `#fff`. `.map-btn.active` ring: `box-shadow: 0 0 0 3px var(--focus-inner), 0 0 0 5px var(--primary)`. Remove the `style="..."` colour overrides and use the classes. Data-mode chips and speed buttons in settings are inline-styled in a different look than `.chip-btn[aria-pressed]` / `.tab` used on the next tab: switch to `class="chip-btn" aria-pressed="..."` (existing rule already gives `--primary`/`--on-primary` pressed state) and delete the inline style.

### P1-4. Type scale drift: rem and fractional sizes next to the px scale
Existing scale: 13 caption, 14, 15, 16/17 label, 20 title-2, 26 title-1. Off-scale: `0.72rem` (11.5px) tag, `0.78rem`, `0.8rem`, `0.82rem`, `0.84rem`, `0.9rem`, `13.5px`, `12px` (draw), `1.85rem` h1 on animal, `2.8rem` pulse value (`animal.ts:~166`, inline), `1.05rem`.
Fix: snap to scale: pulse-source box 13px/18px; tag 12px min but not below (11.5 is under 12px legibility on field devices); mode TTL 13px; `.draw-title` 14px, `.draw-count` 13px; animal H1 `var(--fs-title-1)` (26px) like every other page (currently 29.6px: breaks the title rhythm), pulse value `clamp(36px, 4vw, 44px)` as a class `.pulse-val-xl` instead of inline `2.8rem` (44.8px). Also `.chrome h1` renders at ~26px/700 while the animal page H1 below repeats the same name at 29px: one of the two should go (P1-9).

### P1-5. Animal page composition
- Two-column Pulse / Position row has very different heights (pulse card tall with an empty band between the big number and "только что"); the 2.8rem number has `margin: .25rem 0` plus a `<p class="muted">` row: set `.panel-block p { margin: 0 }` and gap 8px so the card stops stretching.
- Header row: "Прямой эфир" badge floats at the right of the profile head in a box (`badge-online` with `padding 2px 8px; border-radius 8px`) next to the primary CTA, looking like a button. Move it inline next to the pulse card's "только что" (already has "В реальном времени" chip with the same meaning: it is duplicated). Delete one.
- The duplicate heading: top pill has "Esp32 (Акбас) · 12345678", the page H1 again says "Esp32 (Акбас)". Keep the pill title as `a.animal.title` ("Животное") and the page H1 as the name, or the reverse; do not show it twice.
- "Ошейник: 12345678 ONLINE [Отвязать ошейник]" row: the label is bold 17px, link underline, badge, button all different weights; set label `.muted` 14px, value `.num` 600, localised badge, button `btn-sm`.

### P1-6. Pulse source box is crowded
`desktop_animal_detail.png`, `03b`: the white "Merck Veterinary Manual (Physiologic Constants: Cattle)" tag wraps in 3 lines inside a pill-like rectangle on the right; text left wraps next to it.
Fix: `.pulse-source-head { flex-direction: column; align-items: flex-start; gap: 4px; }` or place the tag below the text; `.pulse-source-tag { white-space: normal; max-width: 100%; border-radius: var(--r-chip); }`; show only "Merck Veterinary Manual" (drop the parenthetical or put it into `title`).

### P1-7. Mobile sheet, bottom nav and demo panel collisions
- `mobile_draw_modal.png` / `05_...`: Demo panel sheet (204px) bottom is under the floating bottom nav (68px + 12px offset): button "Старт" is half covered, "Сбросить" is cut. `.map-panel` mobile `bottom: 92px` assumes nav 68+12+12; the demo content is taller than 204px. Fix: `.map-panel { height: auto; max-height: 204px; }` is not enough; set default sheet `height: 232px` when demo panel exists (`.map-panel:has(.demo-panel)`), or make the sheet content `padding-bottom: var(--space-4)`; and ensure `.panel-scroll { overscroll-behavior: contain; }`.
- `.map-hint` on mobile (`left: 72px; top: 18px`) sits behind the top chrome (chrome is `top: 12px`, 64px tall, z 20 vs hint z 5): hint text would be hidden. Set `top: calc(var(--hh-s) + 28px)`.
- `.map-notice` (`bottom: 24px`) sits behind the mobile panel/bottom nav: `bottom: calc(92px + 204px + 12px)` on mobile or place under the chrome.
- Desktop map panel `top: 76px; bottom: 20px` covers the OSM attribution at bottom-right (`desktop_map.png`: attribution is half under the card, required legally to stay readable). Set MapLibre attribution control to `bottom-left` or give the panel `bottom: 36px`.
- Desktop: the panel's top edge (y=140 in screenshot) is 64px below the top bar bottom edge, leaving an unexplained gap, while `.map-controls` starts at top 88px. Align both to `top: 88px` (one value, `--map-top`).

### P1-8. Reduced motion not respected by several animations
`prefers-reduced-motion` is handled through `html[data-motion="on"]` for most rules, but these run unconditionally: `.badge-online .dot { animation: live-dot-pulse }` (always on), `.draw-vertex.first.ready { animation: pulseFirst }`, `.pulse-crit-badge { animation: pulse-crit-glow }`, `.map-live-alert { animation: slide-down-fade }`, `.draw-vertex { transition }`. Fix: prefix each with `html[data-motion="on"]` (the same gate the rest of the file uses). Keep a static ring for the critical badge (`box-shadow: 0 0 0 3px rgba(181,44,8,.2)`) so the state is not colour-only/animation-only.

### P1-9. Mode tab bar (animal page) is an ad-hoc segmented control with inline styles
`animal.ts:225-231`: tabs use `.tab` (pill, 44px) with inline `display:inline-flex;gap;min-height;cursor` styles, 3 tabs that overflow below ~900px (they wrap into rows on mobile). Fix: add `.tab` rule `display: inline-flex; align-items: center; gap: var(--space-2); white-space: nowrap;` to `app.css`, remove inline styles, and at `max-width: 767px` make the group `display: grid; grid-template-columns: 1fr; gap: var(--space-2)` (full-width 48px options) like `.mode-opt` in settings. The role is `tab` but `aria-current` is used instead of `aria-selected`; use `aria-selected` and `role="tablist"` on the container (a11y).

### P1-10. Settings forms inconsistent card use
Tabs Ферма / Сигналы render bare fields on the page background (no `.panel-block`), while Режим данных / Люди use cards (`desktop_settings_farm.png` vs `desktop_settings_data.png`). Wrap every tab body in `.panel-block.narrow-form` (max 480px) and let the "Сохранить" button be `width: auto; min-width: 200px` (currently a 480px full-width slab). Time zone is a free text input showing "Asia/Almaty": use the existing `.select` with 3-5 common zones if already supported, else add `<datalist>`-less hint "например Asia/Almaty" (string only). The disabled input for "Без ограничения" is drawn as a green filled slab (`--surface-1`): reads as a broken field; use `background: var(--surface-0); border-style: dashed; color: var(--disabled-text)`.

### P1-11. Raw checkbox rendering and colour input
`desktop_settings_signals.png` and the draw modal show dark grey square checkboxes (unchecked) vs green checked ones elsewhere; `.check input { accent-color }` only colours the checked state. Fix: `.check input { appearance: none; width: 24px; height: 24px; border: 2px solid var(--line); border-radius: 6px; background: var(--surface-2-white); } .check input:checked { background: var(--primary) url(<phosphor check, white>) center/16px no-repeat; border-color: var(--primary); }` (inline data-URI svg of the Phosphor "check" is fine). The pen colour input in the draw modal (`map.ts:499`) is a bare `<input type=color>` with a duplicate label "Цвет границы" twice (label + aria text beside the swatch): drop the second text or use it as the hex value.

---

## P2 - polish

- P2-1. "1/2" in the mobile bar (`.conn-short`) has no meaning. Show a 8px status dot + "1/2" and keep `sr-only` long text; or "1 из 2" with the long label hidden below 480px. `.conn` colour `--ok` on `--surface-2` passes (5.5:1+).
- P2-2. Sidebar: farm name "Dumans Farm" and user name are plain 14px lines floating; add `margin-top: var(--space-2)` and a hairline `border-top: 1px solid var(--line-night)` above the lang switch/user block; the "Выйти" outlined button is a different shape (radius 20) than nav items (radius 20, filled): OK, but its 1px white border is `--btn2-border-night` .35 alpha: use `--edge-hot` for consistency.
- P2-3. Nav badge: `min-width: 22px; height: 22px` orange `--signal-map #FF5A1F` with ink text: contrast 5.75:1 fine; on the mobile bottom nav it is positioned at `right: calc(50% - 26px)` and clips the icon on "Оповещения" active state (white on green). Add `box-shadow: 0 0 0 2px var(--surface-0)` ring to separate from icon.
- P2-4. `.badge` has 8px radius/6px dot/2px 8px padding, `.chip` 12px radius, `.chip-btn`/`.tab` pill 999px, `.btn` 20px, fields 16px: four label shapes. Unify status badge to `--r-chip` (12px), `min-height: 24px; padding: 2px 10px` so it matches `.chip`; keep pills for toggles only (CLAUDE.md: no pills everywhere).
- P2-5. Page title block: `.page` top padding 32px vs map page `margin: -12px 0 0`; "К стаду" / "К ошейникам" back link is a bare underlined link at 16px; give it a Phosphor `arrow-left` 20px icon, `min-height: 44px`, no underline until hover (keeps focus ring). Link text colour is `--primary` on `--surface-0`: fine.
- P2-6. Collars list mobile row "Не привязан · — · никогда" (`mobile_collars.png`): dashes and "никогда" strung with dots look unfinished. Show "Не привязан" only plus "Нет сигналов" caption; hide the `—` signal when null. Desktop table "Не привязан" appears twice (animal column and status badge): leave status badge, put "—" in the animal column.
- P2-7. Row pill buttons "Профиль" in collars table is a ghost button at far right with no hover affordance; make the whole row link (already `row-link`) and replace the text with a `caret-right` Phosphor icon + `aria-label`.
- P2-8. Connect page: ESP32 8-digit code input is 640px wide for 8 digits; set `max-width: 320px; font-family: var(--font-mono); font-size: 22px; letter-spacing: .12em; inputmode="numeric"`. Intro paragraph is 3 lines at 18px, shorten with CSS `font-size: 16px` and `max-width: 56ch`.
- P2-9. Skeletons: `.skeleton-row` (64px, `--surface-1`) pulses on `--surface-0` fine; the map loading state `.map-loading` is plain text. Use the same skeleton block (`height: 100%`, grid background already present) with an `aria-busy` label instead of a "Загрузка..." line. Loading on animal page: no skeleton for cards; reuse `.skeleton-row` x3 at 160px.
- P2-10. Modals/menus: `.menu-sheet` radius 32px, `.modal` radius 24px (`--r-block`), `.map-panel` radius 32px, `.chrome` 28px: four large radii. Settle on `--r-header: 28px` for floating containers (chrome, bottom nav 34px stays), `--r-block: 24px` for modals/sheets; change `.menu-sheet`/`.map-panel` from 32px to 28px. Mobile profile menu (`mobile_profile_menu.png`): the name line is unstyled 16px; make it `.caption muted` + email; "Закрыть" is the last action - OK.
- P2-11. Toasts: `.toasts` bottom 96px centred; on desktop the toast floats over the map panel area; fine. Missing `role="status"`? Verify.
- P2-12. Focus: global double ring is good. `.draw-bar`/`.map-btn` rounded controls lose the outline offset against map imagery; keep.
- P2-13. Offline state: the offline banner (`.banner-danger`) is red-filled 40px full-width above the shell: acceptable; ensure on mobile it does not sit under the demo strip (both `position: sticky; top: 0`; use `top: var(--strip-h-live, 0px)`).
- P2-14. Language: the sidebar lang switch uses "RU KK EN" capitals via text; Kazakh special letters (ә ғ қ ң ө ұ ү һ і) were not checked in these screenshots (all RU). Not run: kk screenshots at 320/375 for long words ("Оповещения" equivalents, "Ошейниктер") must be reviewed; apply `hyphens: auto` and `lang` attribute on `<html>` per language so the browser hyphenates correctly.

---

## 5. Numeric contrast check (WCAG 2.2, relative luminance)

| Pair | Ratio | Req | Result |
|---|---|---|---|
| `--nav-text #CDE3D2` on `--surface-3-a #14603A` (sidebar top) | 5.61 | 4.5 | pass |
| nav-text on `--surface-3-c #0A3D24` | 9.09 | 4.5 | pass |
| `--ink-3 #46594D` on `--surface-1 #E1EEDF` | 6.26 | 4.5 | pass |
| `--ok #0D6B3A` on `--surface-1` | 5.50 | 4.5 | pass |
| `--ok` on online badge tint `#E3EFE5` | 5.58 | 4.5 | pass |
| `--signal #B52C08` on `--surface-1` | 5.26 | 4.5 | pass |
| white on `--signal` (danger button) | 6.31 | 4.5 | pass |
| `--warning #7A4A00` on `--surface-1` | 6.23 | 4.5 | pass |
| `--offline` badge text on its tint | 6.69 | 4.5 | pass |
| `--disabled-text #586A5E` on `--surface-1` | 4.81 | 4.5 | pass (disabled exempt anyway) |
| `--mist-2 #BFD3C4` on sidebar green `#0F5033` (lang switch) | 6.02 | 4.5 | pass |
| `--ink` on `--signal-map #FF5A1F` (nav badge) | 5.75 | 4.5 | pass |
| `#b91c1c` on `#fee2e2` (`.pulse-crit-badge`, raw) | 5.30 | 4.5 | pass, but raw |
| `--line #5F7568` field border on `--surface-2` | 4.90 | 3.0 (non-text) | pass |
| `--ok-dot #14934F` on white | 3.95 | 3.0 (non-text) | pass |
| `--signal-map #FF5A1F` on `--surface-0` (marker fill) | 2.95 | 3.0 | marginal, rescued by 2px `--marker-casing` casing: keep the casing on every marker state |
| `--ink-2 #31453A` on `--surface-1` (draw-count) | 8.56 | 4.5 | pass |
| `--ink-3` on white (ghost buttons in draw bar) | 7.51 | 4.5 | pass |

No contrast failures were found for token pairs. The risks are (a) the ~11.5px tags (size, not contrast), (b) raw colours that drift from the palette, (c) text on the map imagery (map hint, map notice) which depends on solid pill backgrounds that exist: keep them solid, never semi-transparent.

## 6. Suggested fix order (about half a day for one engineer)

1. P0-1 mobile chrome (CSS) and P0-3 strings (locales + 4 template lines): biggest visible gain.
2. P0-2 demo strip height var, P0-4 danger zone, P0-5 draw bar offsets.
3. P1-3 colour tokens, P1-8 motion gating, P1-1 table nowrap, P1-6/P1-9/P1-11.
4. P2 as time allows. Re-run `scripts/deep-qa.mjs` at 320/375/768/1280/1440 in ru, kk, en and check `scrollWidth <= innerWidth` before the demo.

Not run in this audit: browser re-verification, landing visual review, kk/en locales, 320/768/1440 widths, keyboard-only pass, screen-reader pass.
