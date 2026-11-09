Status: implemented (QA run complete; 5 bugs open, see "Bugs")

# E2E: real server + real web dashboard, demo modes (MANUAL / AUTO / REAL)

Date: 2026-11-09. Commit under test: `03604f5`. Tester: qa-engineer. No source files were edited, nothing committed.

## Environment

- Disposable Neon branch `e2e-2026-11-09` (id `br-holy-pond-b9dntash`), created from `main` of project `delicate-lab-96200870`. Deleted after the run (verified with `list_branches`: only `main`, `migration-test-0012`, `migration-test-0004-0010`, `backup-before-migrations-2026-11-08` remain). `main` was never written to.
- `prisma migrate deploy` on the branch: "13 migrations found ... No pending migrations" (the branch inherited 0012/0013 from `main`, so the migration step itself was a no-op).
- Server: `node dist/main` (NODE_ENV=development, DEMO_MODES_ENABLED=true, CORS_ORIGINS=http://localhost:3000, SITE_DIST_DIR=site/dist), port 3000, single process serving API and built site. Server log had zero ERROR lines.
- Browser: headless Chrome through `site/scripts/cdp.mjs` (no new dependencies). Language ru unless noted.
- Test accounts only (`owner-e2e@example.test`, `worker-e2e@example.test`, `@example.test` is not a real domain). Test credentials were not recorded here.
- Scratch folder (all evidence): `C:\Users\7272~1\AppData\Local\Temp\claude\459628387e7782d5\ed69547d-52dc-466c-a7b8-451fdf3af5bf\scratchpad\` (scripts `s1..s6.mjs`, `ui1..ui3.mjs`, `lib.mjs`, `server.log`; screenshots in `qa\`).
- Caveat: the DB is remote (Neon, eu-central) and the server is local, so every request pays a WAN round trip. Latency findings below are inflated versus a co-located deploy, but the 409s are logic (lease), not just slowness.

## Result summary

| # | Step | Result |
|---|---|---|
| 1 | Register owner, farm, login, collar by 8-digit code, animal, bind collar, pen | PASS |
| 2 | ESP telemetry protocol (inside / border / outside / unknown code) | PASS (1 note) |
| 3 | MANUAL mode: demo animal, manual telemetry, all 6 event types, Демо flags, alerts | PASS |
| 4 | AUTO mode: start, poll ~3 min, stop, switch to REAL, real data intact | PASS with bugs B1, B2, B5 |
| 5 | Dashboard in browser (login, map, mode switching, Демо strip, manual panel, auto panel, collar add by code, landing) | PARTIAL PASS with bugs B1, B3, B4 |
| 6 | Worker cannot switch modes (403) | PASS |

## Step 1: setup (PASS)

- `POST /auth/register` 201 (returns `token`, `memberships[{farmId, role OWNER}]`), `POST /auth/login` 200, `GET /farms` 200 with `dataMode: "REAL"`.
- `POST /devices {code:"12345678"}` 201, `collar.deviceId = QAM-12345678`, status UNASSIGNED, `isDemo:false`.
- `POST /animals` 201, `POST /animals/:id/assign-collar {deviceId:"QAM-12345678"}` 200 (collarId set).
- `POST /geofences` (square 71.40..71.41 x 51.10..51.11, animalIds=[animal]) 201, `areaHa 77.27`, animal gets `penId`.
- Note: assign-collar takes the `deviceId` (QAM-...), not the code; sending the code under another key gives a clear 400 VALIDATION.

## Step 2: ESP protocol `POST /api/v1/device/telemetry` (PASS)

All 200 responses contain `"code":"12345678"`, the same as in the request.

| Position | zone | inFence | distanceToBorderMeters | signals | nextInterval |
|---|---|---|---|---|---|
| 51.105, 71.405 (inside) | GREEN | true | 349.1 | none | 300 |
| 51.1001 (11 m from border) | YELLOW | true | 11.1 | sound 1275 Hz | 300 |
| 51.10002 (2.2 m) | ORANGE | true | 2.2 | sound 2048 Hz + vibrate 3000 ms | 300 |
| 51.12 (outside) | ESCAPE | false | 1111.9 | none (anti-panic) | 15 |
| back inside | GREEN | true | 349.1 | none | 300 |

- Alerts created for the real animal: `GEOFENCE_BREACH` (CRITICAL, with coordinates) and `GEOFENCE_RETURN` (INFO), `isDemo:false`. Animal list shows `lat/lng/status ok/lastSeenAt` updated.
- Unknown code `99999999`: 401, body `{"code":"99999999","message":"Invalid device credentials","error":"UNAUTHENTICATED"}` (code echoed).
- Missing code and malformed code `abc`: 401 with `code: null`. Note N1: for the malformed `abc` the body could echo the submitted value, but it is not an 8-digit code, so `null` is defensible. Also N2: the 401 body uses `code` for the echoed device code while every other API error uses `code` for an error identifier (`VALIDATION`, `FORBIDDEN_ROLE`, ...); the identifier is in `error` instead. Consistent with the firmware contract, but a client that reads `code` generically will mix them up.
- A device without any pen (first-ping of a freshly registered collar) gets 200 `zone: UNKNOWN`, sensible.

## Step 3: MANUAL mode (PASS)

- `PUT /farms/:id/data-mode {mode:"MANUAL"}` 200. `POST /simulate/animals` 201 (named and default: default gets a Kazakh name, tag `D-00n`, `collarId QAM-DEMO-xxxx`, `isDemo:true`, placed in the auto-created `Демо-пастбище`, `isDemo:true`).
- `POST /simulate/telemetry` inside / border / outside: GREEN 349.1 m, YELLOW 11.1 m sound, ESCAPE 1111.9 m.
- `POST /simulate/events` all six: BREACH -> RED 30 m sound+vibrate; ESCAPE -> ESCAPE 150 m; RETURN -> GREEN; GPS_LOST -> zone UNKNOWN; COLLAR_OFFLINE -> `{ok:true}`; COLLAR_ONLINE -> GREEN. Invalid event -> 400 VALIDATION listing allowed values.
- Alerts of the demo animal: `GEOFENCE_BREACH CRITICAL`, `GEOFENCE_RETURN`, `GPS_LOST`, `DEVICE_OFFLINE`, `DEVICE_RESTORED`, all `isDemo:true`; the real animal's alerts stay `isDemo:false`. Simulating telemetry for a real animal id: 404 "Демо-животное не найдено" (good isolation).
- Note N3: `GET /geofences` in MANUAL returns both the real `Pen A` and a demo pen `Демо-пастбище` with the identical polygon. The two pen labels overlap on the map (see `map-auto-1280.png`: "Дем...ище" and "Pen A" stacked over each other).

## Step 4: AUTO mode (PASS with bugs)

- `PUT data-mode AUTO`: 200, 8 demo animals created. First switch from an empty farm took 14.9 s (B5); later switches 0.4 to 1.9 s.
- Polled `GET /simulation`, `/animals`, `/alerts` every ~13 s for 180 s (14 polls): demo animals 8, positions changed for 7 of 8 between the first sample and later samples, statuses went `ok -> warning -> ok -> danger`; alerts appeared over time (`GPS_LOST` x2, `DEVICE_OFFLINE`, `DEVICE_RESTORED`, `GEOFENCE_BREACH` x3, `GEOFENCE_RETURN` x2), all `isDemo:true`. `until` set about 2 h ahead, `running:true`.
- `PATCH /simulation {speed:5}` 200. `reset` 200 (demo alerts 7 -> 1, scripted opening). `stop` 200 -> `dataMode: MANUAL, running:false` (stop does not leave the demo, it drops to MANUAL; stop twice is idempotent 200).
- `PUT data-mode REAL`: demo data gone (`demo:{animals:0, alerts:0}`), `/animals` only `Burenka`, `/alerts` only the 2 real ones, `/geofences` only `Pen A`, `/devices` only `QAM-12345678`; a real telemetry ping afterwards still returns 200 with echoed code. `simulate/animals` in REAL: 409 with a clear message; `simulation/start` in REAL switches to AUTO (design choice, noted).
- Bugs found during this step: B1, B2, B5 below.

## Step 5: dashboard (PARTIAL PASS)

Evidence screenshots (scratchpad `qa\`): `map-auto-1280.png`, `map-auto-375.png`, `map-manual-1280.png`, `map-manual-375.png`, `map-manual-events-1280.png`, `map-manual-events-375.png`, `settings-manual-*.png`, `settings-auto-*.png`, `confirm-real-*.png`, `settings-real-*.png`, `map-real-*.png`, `alerts-*.png`, `connect-*.png`, `landing-ru-375.png`, `landing-ru-1280.png`.

PASS:
- Login with the test owner lands on `/app/map`; markers render (owner: 1 real + demo markers with dashed `demo` style); no horizontal overflow at 375 and 1280 (`scrollWidth > innerWidth` false on every checked app page).
- Mode switch via Settings -> "Режим данных" radios: REAL -> MANUAL -> AUTO -> REAL all reflect in the Демо strip ("Демо · ручной режим", "Демо · симуляция, не настоящие животные"), strip disappears in REAL (`body.is-demo` removed, panel hidden, only the real marker left). REAL asks for confirmation: `role=dialog`, `aria-modal=true`, focus starts on "Отмена".
- MANUAL panel: add demo animal ("Добавлено: UI Demo", option appears in the select), send position inside / border / outside ("Ответ ошейника: зона GREEN, 349,1 м ..." / YELLOW 11,1 м звук), invalid latitude shows "Введите широту от -90 до 90 и долготу от -180 до 180", all six event buttons work and report the collar response, "Команда выполнена" for COLLAR_OFFLINE. Note: the result line sometimes shows the previous result for a moment after a click (re-render re-inserts the stored `result`), not a functional defect.
- AUTO panel: countdown ("До автостопа: 119:42"), Stop/Reset, herd size input. Marker positions moved between two samples 22-25 s apart (e.g. `834,377 633,839 ...` -> `831,381 875,789 ...`), an alert badge counter appears on "Оповещения", one marker turned orange outside the pen.
- Alerts page shows `Демо` tags on demo alerts (3 of them in the 1280 run); demo filter "Вышло за границу Демо" exists.
- Collar by code: `1234` -> "Код состоит ровно из 8 цифр"; `22222222` -> wizard step 2 "Проверьте связь ... Ожидаем первый сигнал"; duplicate code returns 409 (UI shows the "code taken" text path, console 409 expected). New collars appear in `/app/collars` ("Не привязан").
- Landing: loads with no console errors and no overflow at 320 / 375 / 768 / 1280 / 1440 in ru, kk and en (15 combinations, `errors: []`, `over:false` in all).

FAIL / not run: see B1, B3, B4. Not run: dashboard checks of focus visibility, contrast ratios, reduced motion and special-letter rendering for app screens (only landing overflow and console were measured in all three languages; app screens were tested in ru only; the matrix widths 320, 768 and 1440 for the demo panels were not run; only 375 and 1280 as requested). The landing in `kk` renders Russian text (`landing.ts` has only `ru` and `en` dictionaries, kk falls back to ru, N4: confirm this is intended). Worker UI (browser) was not run; worker was verified through the API only.

## Step 6: worker role (PASS)

Invitation created (`POST /farms/:id/invitations` 201, token read from the dev mailer log), accepted via `POST /auth/invitations/accept` (role WORKER). Worker: `GET /simulation` 200 (read-only, sees mode and counts), `PUT data-mode`, `start`, `stop`, `reset`, `PATCH simulation`, `simulate/animals`, `simulate/telemetry`, `simulate/events` all 403 `FORBIDDEN_ROLE` ("Действие доступно только владельцу хозяйства"). Anonymous `PUT data-mode` 401. Worker `/animals` returns 9 rows (demo included, flagged with `isDemo`).

## Bugs

### B1. Switching AUTO -> REAL and `simulation/start` return 409 "Симуляция занята" most of the time while AUTO is running (high)
- Repro (API): with the farm in AUTO and the simulation running, call `PUT /api/v1/farms/:id/data-mode {"mode":"REAL"}` right after `PUT data-mode AUTO`. Run 4 times (3 s, 5.5 s, 8 s, 10.5 s after starting): 409 in 3 of 4 (each after ~3.6 to 4.2 s waiting), 200 only once. Same 409 for `POST /simulation/start` (hit in 3 of 8 calls, also the very first call after `PUT data-mode AUTO` in step 4, and `start {herd:5}` while running, which therefore never trimmed the herd).
- Repro (UI): at 375 px, owner on `/app/settings` -> Режим данных -> Автоматический (wait for strip), then select Реальный and confirm. Dialog confirms, request gets 409, mode stays AUTO (`settings-real-375.png`, `map-real-375.png` still show the Демо strip; console: `409 .../data-mode`). The same flow at 1280 succeeded on a different attempt, so it is a race, not width related.
- Cause (from `simulation.service.ts`): `setMode(REAL)` and `begin()` both need `simulator.acquireLease(farmId)` and fail with ConflictException when a tick holds it; ticks are long and frequent (8 animals, many sequential queries), so the lease is busy for most of the time. No retry or wait.
- Impact: the owner cannot reliably leave the demo or change the herd. Suggested direction (not applied): wait/retry for the lease with a bounded timeout, or make the tick yield; make the UI retry once on 409 CONFLICT.

### B2. `POST /simulation/start` with `speed` / `herd` is dropped when the 409 in B1 occurs; speed ×10 and herd 5 were not applied (medium)
Consequence of B1, listed separately because the UI "Start" button then reports an error while the farm is already AUTO.

### B3. Speed chips (and any `aria-pressed="${bool}"`) render `aria-pressed=""` for every value (medium, accessibility and visible state)
- Repro: open `/app/map` in AUTO, run `[...document.querySelectorAll('[data-speed]')].map(b=>b.getAttribute('aria-pressed'))` -> `["","","",""]` (also at 375). Selected speed (server `speed:5`) is not highlighted in `map-auto-1280.png`.
- Cause: `site/src/dom.ts` line 14 `html` template turns `true`/`false` into `''`, so `aria-pressed="${v === speed}"` in `demo-panel.ts` yields `aria-pressed=""` for both states. Same pattern for `d-pick` (`aria-pressed="${picking}"`) and probably elsewhere (grep `aria-pressed="\${`).
- Impact: screen readers do not get a pressed state; CSS keyed on `[aria-pressed="true"]` never matches. WCAG 4.1.2.

### B4. Collar-by-code wizard never completes for a collar that is not bound to an animal (medium)
- Repro: owner `/app/collars/connect`, code `22222222`, leave "Животное" empty -> step 2 "Ожидаем первый сигнал…". Send `POST /api/v1/device/telemetry {code:"22222222", ...}` (200, `lastSeenAt` is set). Wait 25+ s: the wizard still waits. `GET /devices/QAM-22222222` shows `status:"UNASSIGNED"` with `lastSeenAt` set; the wizard only advances on `status === "ONLINE"` (`connect.ts` poll). Same at 375 with `33333333`.
- Impact: a collar that really talks to the server looks stuck in setup; user is told nothing. Suggested: treat `lastSeenAt != null` (or status UNASSIGNED with a fresh `lastSeenAt`) as "signal received".

### B5. First switch to AUTO takes about 15 s (low to medium)
`PUT data-mode AUTO` on a farm without a demo herd: 14.9 s (later: 0.4 to 1.9 s). While waiting, the Settings radios are disabled with no progress indication (`settings-auto-1280.png`). Mostly sequential Neon round trips from a local server; re-measure on the Render+Neon deployment before acting.

### Minor / observations
- M1: In Settings -> Режим данных the three radio indicators all look like filled dark discs; only the tinted card shows which is selected (`settings-auto-1280.png`). Needs a visible checked state.
- M2: Strip text reads "Демо Демо · ручной режим" (tag plus the same word again); redundant, and the accessible name concatenates them without a space ("ДемоДемо").
- M3 (N3): duplicate demo pen over the real pen with identical geometry, overlapping labels.
- M4: with AUTO running the map still lists real animals alongside the demo ones (by design per the Settings intro text); the header counter is "На связи: 8 из 13" when 13 includes 4 earlier UI Demo animals, fine.

## Cleanup

- Server process (PID 7776) stopped, port 3000 closed.
- Neon branch `e2e-2026-11-09` deleted; no other branch touched.
- Scratch `e2e.env` (contained the connection string for the deleted branch) removed. The connection string was returned once in the Neon tool output in this session (unavoidable with the MCP tool); it is dead with the branch.
- `git status` clean: no repo files changed other than this report.
