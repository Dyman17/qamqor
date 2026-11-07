Status: draft

# QA: mockups phase 1 (index, components, screen-map S2)

Date: 2026-11-07. Tester: qa-engineer. Target: `docs/frontend/mockups/` served at http://127.0.0.1:8765/ (Chrome in the built-in browser pane). No mockup file was edited. Language state in localStorage was reset after testing.

## Method and limits

- Widths and frame sizes were tested by loading each page in a same-origin hidden iframe of the exact width and running DOM checks inside it (so media queries and container queries behave as at that viewport). The real viewport was also resized (320, 375, 768, 1000, 1366, 1440) for screenshots and keyboard tests.
- The pane is small, so screenshots are scaled; they are evidence of layout, not of pixel detail.
- Overflow check: `documentElement.scrollWidth > innerWidth`; plus any visible element whose right edge is beyond the viewport (map layer and the frame scroll containers excluded); plus a per-word range check for a single word spanning two line boxes.
- Contrast: own script, `getComputedStyle` colour, alpha blending through ancestor backgrounds and opacity, WCAG 2.x ratio. Transition-in-progress samples were discarded (re-measured after 260 ms).
- Screenshots: `docs/frontend/qa/img/2026-11-07/`.

## Summary

| # | Item | Result |
|---|---|---|
| 1 | Responsive matrix | PASS (with minor findings m1, m2, m3) |
| 2 | Contrast, 87 text/background pairs + 7 marker glyph pairs | FAIL (M1) |
| 3 | Keyboard walkthrough | PASS (with minor m6) |
| 4 | prefers-reduced-motion | PASS by CSS inspection; real emulation NOT RUN |
| 5 | Kazakh letters and fonts | PASS |
| 6 | Functional | PASS with defects (m4, m5, m7, m8, m9) |
| 7 | Console and network | PASS |
| 8 | Text vs app-ui-spec S2 | PASS for texts present; gaps listed (M2, m10, m11) |

No blockers. 2 major, 11 minor.

## 1. Responsive matrix

- Page chrome, index.html, components.html, screen-map.html x 320/375/768/1280/1440 x ru/en/kk = 45 combinations: `scrollWidth == innerWidth` in all 45; no element beyond the viewport.
- Device frames (embed mode) x 320x640, 375x812, 768x1024, 1366x1024, 1024x1366 x 7 states x (3 sheet positions on phones, 1 on tablets) x ru/en/kk = 189 combinations: no horizontal overflow, 0 elements outside the frame.
- 1024x1366 portrait: uses the 768 layout (rail, side panel 360 px, long badge "На связи: 138 из 142", no top bar, no bottom nav). 768 gives 360; 1100x800 and 1366x1024 give 420. PASS.
- Words: no word breaks letter by letter. The only multi-line "words" are hyphen wraps: "native-speaker" (index/components/screen-map, en, 320 and 375) and "DEMO-07" (components kk; alert row in screen-map kk at 320). Acceptable, listed as m3.
- Evidence: `p375-half-ru-normal.jpg`, `p320-half-kk-offline.jpg`, `t1366-normal-kk.jpg`, `t768-loadinglong-en.jpg`.

Findings:
- m1. 320x640, half sheet, state offline or error (ru, kk): the map area is only 256 px high, the FAB column wraps into two columns and the "fit herd" FAB overlaps the map placeholder plate (ru and kk; en does not overlap). Repro: `screen-map.html?embed=1&sheet=half&lang=kk&state=offline` at 320x640. Screenshot `p320-half-kk-offline.jpg`.
- m2. 320 px: farm name is cut to "Ферма …" / "Farm “D…", so the distinguishing part ("Демо") is not visible. Ellipsis is allowed by the spec, but the button is the only place that names the farm. Suggest dropping the badge text size or letting the name take the space first.
- m3. Hyphen wraps above (DEMO-07, native-speaker). Optional: non-breaking hyphen.

## 2. Contrast (WCAG 2.2 AA: text 4.5, large text and non-text 3)

Pairs that passed or failed (token values in brackets). Full measurement covered ru/en/kk x 7 states x satellite/scheme layer x 375 phone and 768 tablet.

| # | Element | fg on bg | Ratio | Result |
|---|---|---|---|---|
| 1 | Primary button "Нарисовать забор" | #FFFFFF on #17802C | 5.05 | pass |
| 2 | Secondary button "Профиль" | #17802C on #FFFFFF | 5.05 | pass |
| 3 | Secondary button "Перегнать стадо" | #17802C on sheet bg (#E8F2DB..#EBF3DF, in states with tint) | 4.31 to 4.51 | borderline, see note |
| 4 | Tertiary "Показать на карте" in unread alert | #17802C on #D9F2C4 (primary-tint) | 4.19 | FAIL (M1) |
| 5 | Tertiary "Повторить" in error banner (13 px) | #17802C on #FFE4DF (danger-bg) | 4.19 | FAIL (M1) |
| 6 | Rail nav label active "Карта" (768, 13 px bold) | #17802C on #D9F2C4 | 4.19 | FAIL (M1) |
| 7 | Bottom nav label active (375, 12 px bold) | #17802C on #FFFFFF | 5.05 | pass |
| 8 | Bottom nav label inactive "Стадо" | #3A5540 on #FFFFFF | 8.22 | pass |
| 9 | Nav badge "3" | #FFFFFF on #C21F14 | 6.00 | pass |
| 10 | Connection badge "138/142" | #00705A on #D2F1E4 | 5.03 | pass |
| 11 | Badge "Применён" / status chips | #00705A on #D2F1E4 | 5.03 | pass |
| 12 | Badge "Черновик" | #0F62B5 on #DCEBFA | 5.04 | pass |
| 13 | Out-of-zone label in alert "Вне зоны" | #C21F14 on #FFE4DF | 4.98 | pass |
| 14 | Server error banner text | #C21F14 on #FFE4DF | 4.98 | pass |
| 15 | Offline banner text | #4D5560 on #E7EAEE | 6.25 | pass |
| 16 | Summary tile numbers 1 / 2 / 2 | #C21F14, #8A4B00, #4D5560 on #FFFFFF | 6.00 / 6.80 / 7.54 | pass |
| 17 | Summary tile label | #3A5540 on #FFFFFF | 8.22 | pass |
| 18 | Muted time "5 мин назад" on unread alert | #4F6A55 on #D9F2C4 | 4.95 | pass |
| 19 | Muted caption in mini card | #4F6A55 on #F4FBEE | 5.64 | pass |
| 20 | Map label "Загон «Северный»" over map placeholder (90% surface plate over #23301F-ish map) | #14301A on ~#E9EAE9 | 11.88 | pass |
| 21 | Animal number "0142" under marker | #14301A on ~#E9EAE9 | 11.88 | pass |
| 22 | Map placeholder caption | #3A5540 on #FFFFFF | 8.22 | pass |
| 23 | Disabled button text "Нарисовать забор" (offline) | #6B7A66 on ~#E3EFD3 | 3.82 to 4.36 | below 4.5; disabled controls are exempt from 1.4.3, noted |
| 24 | Cluster count "14" | #14301A on #FFFFFF | 14.31 | pass |

Marker glyphs and shapes (non-text, need 3:1):

| Marker | glyph on fill | Ratio |
|---|---|---|
| In zone (ink check on #1FBF8F) | | 6.07 |
| No fence (ink dot on #FF9F0A) | | 6.96 |
| Out of zone (white "!" on #E5352B) | | 4.31 |
| No connection (ink slash on #8A929C) | | 4.55 |
| Marker ring ink vs halo white | | 14.31 |
| Halo white vs placeholder map #2F4127 | | 11.02 |

Focus ring (#1B4FD6, 3 px + 2 px white gap): 5.5 to 6.7 against bg, surface, sunken, tint and status backgrounds. Against the dark map placeholder the outer edge is 1.3 to 1.65, but the 2 px white gap inside the ring is 11:1 against the map and 6.7:1 against the ring, so the indicator stays visible (screenshot `p320-peek-en-focus-marker.jpg`). On primary-filled buttons (#17802C) the ring is 1.33 against the fill, again saved by the white gap. Accepted.

Note on row 3: the sheet background in those states is a blended sunken tone only during the 120 ms transition and in the "loading" skeleton states; in the stable normal state the secondary button is on white (5.05). Not counted as a defect.

## 3. Keyboard-only walkthrough (screen-map.html)

Real Tab / Shift+Tab / Enter / Escape / Arrow keys.

- Skip link: first stop (kk "Мазмұнға өту"), visible, focus ring visible. Enter jumps to `#main`; next Tab lands on the first control inside the frames. PASS.
- Page chrome order: skip link, "К списку макетов", language chips (3), then one stop per radio group (state, sheet, role, scale; arrows move inside a group), then frames. PASS.
- Phone frame order (375, peek): farm button, connection badge, settings, 11 markers + cluster (each with a label such as "Cow #0142, Out of zone"), 3 FABs, sheet handle, sheet chevron, 3 summary tiles, bottom nav (4). Logical (top to bottom). PASS.
- Focus ring: 3 px solid #1B4FD6 on every one of the 27 stops in the frame (topbar, dark map markers, FABs, sheet, bottom nav). PASS.
- Sheet full: handle/chevron to full sets `role="dialog"`, `aria-modal="true"`, labelled by "Herd summary"; focus moves to the sheet title; the 9 outside regions (banners, topbar, rail, pills, map, FABs, bottom nav) get `inert`. Tab cycles inside the sheet (wraps from "2 No fence" back to the handle) and never leaves. Escape returns to half, sets `role="region"`, removes `aria-modal` and `inert`, and returns focus to the chevron that opened it. PASS.
- Language menu (tablet rail): Enter opens, `aria-expanded=true`, focus on the checked item (English); ArrowDown moves; Escape closes and returns focus to the trigger; Enter+Down+Enter selects Қазақша, closes, returns focus to the trigger, sets `lang="kk"`, stores kk. PASS.
- m6. Escape in the non-modal half sheet also collapses it to peek whenever focus is inside it. Defensible, but it differs from the spec (Back or chevron only) and a user tabbing through the list loses the half state on an accidental Esc. Minor.
- Evidence: `p375-full-en-focus-chev.jpg`, `chrome-1366-kk-focus.jpg`.
- Not run: screen reader announcement (no AT available), VoiceOver/TalkBack.

## 4. prefers-reduced-motion

- Emulation was not possible with the tools. CSS inspection: one block `@media (prefers-reduced-motion: reduce)` (mockups.css, near line 548) sets `animation: none; transition: none; scroll-behavior: auto` on `*, *::before, *::after`, and removes the `:active` transforms.
- Every motion in the source: `transition` in `.btn` (line 58) and `.mk .mk-svg` (line 380), `.spin` animation (line 73), `.skel` pulse (line 199). All covered by the universal rule. No JS animation (`animate(`, `scrollTo`, `scrollIntoView` not used). Toast uses a timer only (no motion).
- Result: PASS by inspection. Real run: NOT RUN.

## 5. Kazakh letters and fonts

- `document.fonts`: Noto Sans (100 to 900) loaded, Noto Serif (100 to 900) loaded; self-hosted `.ttf` from `assets/fonts/`.
- Computed font-family: 602 text elements `"Noto Sans", system-ui, sans-serif`, 4 headings `"Noto Serif", Georgia, serif`. No other families.
- Glyph coverage (fontTools cmap of both bundled fonts): ә ғ қ ң ө ұ ү һ і and Ә Ғ Қ Ң Ө Ұ Ү Һ І, all 18 present in Noto Sans and Noto Serif. Canvas measure with Noto only gave plausible, non-fallback widths for all 18.
- Rendered specimen (sans, bold sans, serif, upper and lower case) in `components-kk-specimen.png`. No tofu, no fallback shapes visible.
- The app uses no CSS `text-transform: uppercase`, so no case-mapping issue.
- PASS. Limit: which face actually painted each glyph cannot be read from the browser; evidence is cmap + loaded status + family stack.

## 6. Functional

Every one of the 47 controls on the screen was clicked in a 375 frame.

- Stubs: all show an in-frame notice "Экран «…» будет в следующих фазах макетов" (no fake success). PASS.
- Real behaviour: marker tap, layers FAB (pressed state, base map swaps to scheme palette), sheet handle/chevron, language menu, mini card close, all work.
- No-op: current nav item "Карта" (expected, current page).
- States panel (ru), verified texts and available actions:
  - Loading: "Загружаем карту", skeleton, write buttons disabled. Loading long: adds "Долго? Проверьте связь" + "Повторить". PASS.
  - Empty animals: "Здесь пока нет животных. Привяжите ошейник к животному" + "Добавить ошейник". Empty pens: "Нарисуйте первый загон" + button. PASS.
  - Error: banner "Не удаётся связаться с сервером" + "Повторить", map from cache, write buttons disabled with note. Offline: banner "Нет подключения к сети. Показаны данные на 14:02", "обновлено 14:02", write disabled. PASS.
- Role switch to worker: draw/move buttons, offline/error write notes and mini-card "Выбрать для перегона" are hidden in all three frames; empty pens shows the phrase only (no button). PASS.
- Layers FAB: toggles `aria-pressed`, scheme palette. Marker tap: mini card with name, tag, status badge, time; sheet peek goes to half; close clears selection. PASS.
- Panel radios (state, sheet, role, scale 100/75/50): apply to all frames; 50% scale: no page overflow. PASS.
- Defects:
  - m4. Cluster toast shows an unfilled placeholder: «Экран «Группа из {n} животных»…». Cause: the stub handler calls `t(key)` without the `data-p` params. Repro: click the "14" cluster.
  - m5. Layers on (scheme): the map caption still says "плейсхолдер спутниковой карты" / "satellite map placeholder".
  - m7. Loading state: spec says everything actionable is disabled. Only the draw and move buttons are disabled; farm, badge, settings, FABs, sheet handle and bottom nav stay enabled (12 live controls).
  - m8. Toast wording "Экран «Повторить» / «Прочитано» / «Моё положение»" calls actions screens. Cosmetic.
  - m9. Mock data inconsistent: the same cow #0231 is "Ошейник DEMO-07" in the alert and "бирка DEMO-A12" in the mini card; every animal shows tag DEMO-A12.

## 7. Console and network

- Console: no messages (no errors, no warnings) on index, components, screen-map (checked after fresh load; the log buffer starts at attach).
- Network: all requests are `http://127.0.0.1:8765/…` (html, tokens.css, mockups.css, 5 js files, fonts.css, 2 ttf). Per-page `performance.getEntriesByType('resource')` for 4 pages: 10 resources each, 0 non-local. No CDN, no external fonts. PASS.

## 8. Text accuracy vs app-ui-spec.md S2

Match (ru): "Загружаем карту"; "Долго? Проверьте связь" + "Повторить"; "Здесь пока нет животных. Привяжите ошейник к животному" + "Добавить ошейник"; "Нарисуйте первый загон" (worker: phrase only); "Не удаётся связаться с сервером" + "Повторить"; "Нет подключения к сети. Показаны данные на {время}"; "обновлено {время}"; top bar farm + 138/142 + settings; tablet long badge "На связи: 138 из 142"; FABs "Слои/схема", "Моё положение", "Ко всему стаду"; "Нарисовать забор", "Перегнать стадо"; pen status "Применён" / "Черновик"; mini card "Профиль" / "Выбрать для перегона"; alert actions; stale-GPS marker as circle with diagonal; bottom nav and rail order.

Differences and gaps:
- M2. Kazakh: 64 strings equal the Russian text and 73 keys have no kk value (all non-"mk." keys fall back to ru). About 40 S2 product strings show Russian in kk: banners, loading and empty texts, long badge, pen list headings, alert buttons, toast. Known and flagged in the panel note ("Казахские строки черновые"), but a kk screenshot is not representative of the final design until native-speaker text is supplied. Not a layout defect. Kazakh strings that do exist (tiles, bottom nav, top actions) fit without breaking.
- m10. Spec states not shown: "Всё в порядке, обновлено {время}" (string `sheet.allOk` exists, no state reaches it); the one-time Wi-Fi prototype plate with "Понятно". Also "Низкий заряд" item (conditional in spec, acceptable) and the 3-alert maximum (2 shown).
- m11. Spec peek summary is a line "Вне зоны: N · Без границы: N · Нет связи: N"; mockup uses three tiles with big numbers and no colon. Reasonable visual interpretation; the owner should confirm. The cluster appears with 11 animals while the spec says it appears above 30 markers (sample data).
- Spec says the sheet in loading state shows a skeleton and "всё действующее выключено" (see m7).

## Issues ranked

### Blocker
None.

### Major
- M1. Text contrast below 4.5:1: tertiary button #17802C on primary-tint #D9F2C4 and on danger-bg #FFE4DF (4.19:1; "Показать на карте", "Открыть профиль", "Прочитано" in unread alert cards, "Повторить" in the error banner); active rail label #17802C on #D9F2C4 (4.19:1, 13 px bold, tablet 768+). Repro: `screen-map.html?embed=1&sheet=half` (alerts), `state=error`, and the 768 or 1366 embed (rail). Fix suggestion: use `--primary-pressed` (#10601F) text on tinted backgrounds, or a lighter tint.
- M2. kk: about 40 S2 strings are Russian copies; see item 8. Needs owner-supplied or native-speaker Kazakh before kk is judged.

### Minor
m1 320 half offline/error FAB wrap and overlap; m2 farm name truncated to nothing useful at 320; m3 hyphen wraps; m4 `{n}` placeholder in cluster toast; m5 layer caption stale; m6 Esc collapses half sheet; m7 loading state leaves controls enabled; m8 toast says "screen" for actions; m9 inconsistent sample tag; m10 spec states "всё в порядке" and Wi-Fi plate absent; m11 summary format and cluster threshold differ from spec.

## Not run

- Real `prefers-reduced-motion` emulation.
- Screen reader testing (VoiceOver, TalkBack, NVDA).
- Real touch devices (touch target size measured in CSS only: markers 48x48, FABs 52x52, tiles 109x48, nav 94x63; all >= 44).
- Browsers other than Chromium; print.
- components.html and index.html were covered by overflow, font and network checks only; their per-component contrast and functional behaviour were not tested (the brief asked for screen S2).

## Evidence index

`docs/frontend/qa/img/2026-11-07/`: `p375-half-ru-normal.jpg`, `p320-half-kk-offline.jpg`, `p320-peek-en-focus-marker.jpg`, `p375-full-en-focus-chev.jpg`, `t1366-normal-kk.jpg`, `t768-loadinglong-en.jpg`, `chrome-1366-kk-focus.jpg`, `components-kk-specimen.png`.

## Retest 2026-11-07 (after engineer fix pass)

Method: served from a temporary `python -m http.server` on 127.0.0.1:8766 (stopped afterwards); same iframe technique as above; contrast re-measured from computed DOM colours (59 unique pairs, ru/en/kk, 9 states incl. new allOk and wifi, satellite and scheme, 375 phone and 1366 rail; samples re-taken after 280 ms). No mockup file edited. Screenshots not retaken.

| Item | Result | Evidence |
|---|---|---|
| M1 tertiary on tint / danger-bg | PASS | tertiary on #D9F2C4 now #10601F, 6.43:1; "Повторить" on #FFE4DF 4.98:1; wifi "Понятно" 5.04:1; rail active label now #14301A on #D9F2C4, 11.89:1. No non-disabled text below 4.5 once settled (two 1.2 and 4.22 readings in the first pass were transition samples; settled 5.05, re-verified). Disabled text 3.82 is exempt. |
| M2 kk strings in Russian | NOT RE-CHECKED (content gap; needs native Kazakh text) | still open |
| m1 320 half offline/error FAB overlap | PASS (residual) | no overlap with caption in ru/en/kk; FABs still wrap to 2 columns (252/192 px), bottom 244 vs sheet top 256 |
| m2 farm name at 320 | PASS | name is now "Ферма Демо" / "Farm Demo", fits without ellipsis (scrollWidth == clientWidth) |
| m3 hyphen wraps | PASS | DEMO-07 now non-breaking; only "4-4)," in an en spec string wraps at its hyphen |
| m4 cluster toast | PASS | "В макете не подключено: Группа из 14 животных" |
| m5 caption vs layer | PASS | "плейсхолдер схемы карты" after layers toggle |
| m6 Esc | PASS | Esc in half stays half; Esc in full returns to half, focus on the chevron |
| m7 loading disables controls | PASS | loading: 0 live controls; loadingLong: only "Повторить" |
| m8 toast wording | PASS | now "В макете не подключено: …" |
| m9 sample tag | FAIL (cosmetic) | cow #0231: mini card "бирка DEMO‑A31", alert "Ошейник DEMO‑07" |
| m10 missing states | PASS | «Всё в порядке, обновлено 14:02» (allOk) and Wi-Fi plate «Ошейники вне зоны Wi-Fi фермы…» + «Понятно» (role=status; button hides the plate) in panel and code |
| m11 summary format / cluster threshold | NOT RE-CHECKED (owner decision) | tiles unchanged |
| Alerts nav accessible name | PASS | "Оповещения, 3 новых" / "Alerts, 3 new" / kk "Ескертулер, 3 новых" (kk suffix is Russian) |
| One `<main>` per page | PASS | index, components, screen-map and each embed frame: 1 |
| Tablet full sheet not modal | PASS at runtime, FAIL via URL | after load, `setSheet('full')` at 768, 1024x1366 and 1366 gives role=region, no inert. Loading `?embed=1&sheet=full` on a tablet still gives role=dialog, aria-modal=true and 10 inert regions with no visible handle (N1) |
| Phone full sheet dialog | PASS | role=dialog, aria-modal, 10 inert, focus returns |
| Overflow spot check | PASS | 216 combinations: 3 pages x 320/375/1366 x ru/en/kk, plus frames 320x640, 375x812, 1366x1024 x 9 states x sheets x 3 languages: 0 overflow |

New issues
- N1 (minor): `screen-map.html?embed=1&sheet=full` (or `sheet=full` in the page) at a tablet width builds a modal dialog with everything inert, while the side panel has no way to leave it. Build-time path ignores the tablet rule used at runtime.
- N2 (minor, cosmetic): m9 above.
- N3 (minor): in the wifi state the summary shows "0 Вне зоны / 0 Без границы / 11 Нет связи" but the alert list below still lists an out-of-zone alert for cow #0142 ("Вышло за забор"). Sample data inconsistent.

Not run in retest: reduced-motion emulation, screen readers, contrast of components.html.
