# Qamqor Mobile App (`app/`)

Status: implemented (client of the deployed server; see `docs/architecture/api-contract.md`).

Expo (SDK 52) + React Native + TypeScript. Russian UI. Design: `docs/frontend/app-design-brief.md` (tokens in `src/theme/tokens.ts`, phone scaling in `src/theme/scale.tsx`).

## Server

Base URL, in order of priority: `EXPO_PUBLIC_API_URL`, `app.json` `expo.extra.apiUrl`, default `https://qamqor-api.onrender.com/api/v1`.
The free Render instance may need up to a minute to wake up on the first request.

## Screens (all on real endpoints)

- **Вход / регистрация**: `POST /auth/login`, `/auth/register`; response `{token,user,memberships}`. The session is stored in AsyncStorage and restored on start.
- **Выбор фермы**: shown when the user has several farms; every data request carries `x-farm-id`.
- **Карта**: pens (GeoJSON polygons) and animal markers drawn with `react-native-svg` on a plain canvas (no satellite tiles).
- **Стадо**: list, search, status filter, "+ Животное" (`POST /animals`).
- **Профиль животного**: details, bind/unbind a collar, test signals (sound / vibration) via `POST /devices/:id/test-signal` (queued; the collar executes it on its next ping).
- **Оповещения**: list, acknowledge / resolve (`PATCH /alerts/:id/status`); tab badge = active alerts.
- **Ошейники**: list; the owner adds a collar by its 8-digit code (`^[0-9]{8}$`, `docs/architecture/device-code-protocol.md`).
- **Настройки**: account, farm, role, "worker can edit boundaries" (owner only), switch farm, sign out.

Roles: OWNER and WORKER. There is no impulse control and no battery indicator.

## Known assumptions

- Collar registration calls `POST /devices {deviceId: <8-digit code>}` (`registerCollarByCode` in `src/services/api.ts`). Change only that function if the server adds a dedicated claim endpoint.

## Commands

```
npm install
npx tsc --noEmit
npx expo start              # dev
npx expo export --platform android   # JS bundle check
```

APK build (not run from this repo yet): `npx expo prebuild --platform android` then Gradle, or EAS Build. Android package `kz.qamqor.app`, versionCode 1.
