Status: draft

# Qamqor: контракт REST API (приложение и ошейник)

Связанные документы: [../plans/backend-hardening.md](../plans/backend-hardening.md), [../requirements.md](../requirements.md), [../frontend/app-ui-spec.md](../frontend/app-ui-spec.md). Целевое состояние сервера после плана; текущее состояние описано там же.

## 0. Факты, допущения, рекомендации

**Проверено по коду (2026-11-08):**
- Все контроллеры живут под префиксом `api/v1/...` (прописан в декораторах `@Controller`). Приложение берёт базовый URL `EXPO_PUBLIC_API_URL` (по умолчанию `http://localhost:4000/api/v1`).
- Приложение (`app/src/services/api.ts`) вызывает: `GET /animals`, `/devices`, `/geofences`, `/alerts`, `POST /device/trigger`, `POST /animals/:id/assign-collar`. Заголовок `x-farm-id` не шлёт. Ответы типизирует как `Animal`, `Collar`, `AlertItem`, `GeofencePen` из `app/src/types/index.ts`, но форматы сервера другие (сервер отдаёт строки Prisma: `lastLatitude`, `tagNumber`, `battery` и т. д.).
- `POST /animals/:id/assign-collar` и `/steer` на сервере отсутствуют (есть только в README).
- `Collar.battery` в типах приложения и `device.battery` на сервере противоречат решению владельца «датчика заряда не будет».

**Допущения:** клиент сам считает относительное время («5 мин назад») из ISO-времени; приложение и сервер меняются в одной ветке, обратная совместимость со старым приложением не нужна (приложение не выпущено).

**Рекомендации (приняты как значения по умолчанию в плане):**
1. Сервер — источник истины, отдаёт доменные DTO (ниже) с ISO-временем. Приложение приводит свои типы к ним и считает `lastSeenMinutesAgo`, `timeAgo`, `pen` локально. Исключения помечены «меняется приложение».
2. Любой запрос к данным фермы несёт `x-farm-id`; без заголовка сервер берёт единственную ферму пользователя, а если ферм несколько, отвечает 400.
3. Импульс (шок) в API не возвращается и не принимается, пока владелец не подтвердит железо и ветеринарное заключение. Числовые характеристики импульса нигде не отдаются.

## 1. Общие правила

- Формат: JSON, UTF-8. Время: ISO 8601 UTC. Координаты: `lat`, `lng` (WGS84). Полигоны: GeoJSON `Polygon`, порядок `[lng, lat]`, кольцо замкнуто, 3–500 вершин.
- Авторизация приложения: `Authorization: Bearer <JWT>`. Авторизация ошейника: `Authorization: Bearer <deviceSecret>` (отдельный секрет на ошейник, показывается один раз).
- Ошибки: `{ "statusCode": number, "code": string, "message": string }`. Коды: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN_ROLE`, `FORBIDDEN_FARM`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`.
- Права: **O** — только владелец; **W** — владелец и работник; **B** — владелец, либо работник при `farm.workerCanEditBoundaries = true`; **Д** — ошейник; **—** — без авторизации.
- Пагинация списков (`GET /animals`, `GET /alerts`): `?limit` (1–100, по умолчанию 50) и `?cursor` (id последнего элемента предыдущей страницы). Ответ остаётся массивом; курсор следующей страницы приходит в заголовке `X-Next-Cursor` (его нет на последней странице).

## 2. Типы (ответы)

```ts
type Role = 'OWNER' | 'WORKER';
type AnimalStatus = 'ok' | 'danger' | 'warning' | 'offline';   // вычисляется сервером
type ConnState = 'ONLINE' | 'OFFLINE' | 'UNASSIGNED';           // без LOW_BATTERY

interface UserDto { id; email; fullName; phone?: string; }
interface MembershipDto { farmId; farmName; role: Role; }
interface AuthResponse { token: string; user: UserDto; memberships: MembershipDto[]; }

interface FarmDto {
  id; name; description?: string; timezone: string;        // IANA, по умолчанию 'Asia/Aqtau' (UTC+5, решение владельца 2026-11-08)
  workerCanEditBoundaries: boolean;                         // по умолчанию false
  myRole: Role;
}
interface SignalLimitDto { level: 'SOUND' | 'VIBRATION' | 'IMPULSE'; dailyLimit: number | null; unlimited: boolean; }

// status: danger — последняя позиция вне границы; offline — нет ошейника или он молчит дольше порога;
// warning — активное GPS_LOST / SIGNAL_LIMIT_REACHED; иначе ok. DELETE /geofences/:id и /animals/:id отвечают 204.
interface AnimalDto {
  id; farmId; name; tag: string;              // tag = tagNumber
  species: 'CATTLE' | 'HORSE' | 'CAMEL' | 'SHEEP' | 'GOAT'; gender; breed?: string; birthDate?: string; photoUrl?: string;
  penId: string | null;                       // activeGeofenceId; null = «Без границы»
  collarId: string | null;                    // deviceId
  lat: number | null; lng: number | null; accuracyM: number | null; lastSeenAt: string | null;
  status: AnimalStatus;
}
interface CollarDto {
  deviceId; status: ConnState; animalId: string | null; animalName: string | null;
  signalRssi: number | null; firmwareVersion: string | null; lastSeenAt: string | null;
}                                                // нет battery, нет secret
interface PenDto {
  id; farmId; name; color: string; polygon: GeoJSONPolygon; animalsCount: number; areaHa: number; // areaHa считает сервер
}
interface AlertDto {
  id; type: 'GEOFENCE_BREACH' | 'GEOFENCE_RETURN' | 'DEVICE_OFFLINE' | 'DEVICE_RESTORED' | 'SIGNAL_LIMIT_REACHED' | 'GPS_LOST';
  severity: 'INFO' | 'WARNING' | 'CRITICAL'; status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  animalId: string | null; animalName: string | null; penName: string | null;
  message: string; lat: number | null; lng: number | null; createdAt: string; isRead: boolean;
}
interface InvitationDto { id; email; status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'; expiresAt; }
```

Соответствие `app/src/types`:

| Поле приложения | Сторона, которая меняется |
|---|---|
| `Animal.tag`, `collarId`, `lat`, `lng`, `status` | совпадают с `AnimalDto` |
| `Animal.pen` (название) | меняется приложение: берёт по `penId` из списка загонов |
| `Animal.lastSeenMinutesAgo` | меняется приложение: из `lastSeenAt` |
| `Collar.battery` | **удаляется в приложении** (решение владельца) |
| `Collar.signalRssi`, `firmwareVersion`, `status` | совпадают; `status` без LOW_BATTERY |
| `AlertItem.type` (`danger`/`offline`/`warning`) | меняется приложение: отображение из `AlertDto.type` |
| `AlertItem.timeAgo`, `isRead` | `timeAgo` — приложение из `createdAt`; `isRead` — сервер |
| `GeofencePen.polygon: number[][]` | меняется приложение: принимать GeoJSON `polygon`; `isApplied` убрать или вычислять, пока нет версий границ (A3) |

## 3. Эндпоинты для приложения

### Аутентификация (—, кроме `me`)

| Метод и путь | Права | Запрос | Ответ | Заметки |
|---|---|---|---|---|
| `POST /auth/register` | — | `{email, password(8–72 символа и не более 72 байт), fullName, phone?, farmName?}` | `AuthResponse` | создаёт пользователя, ферму, членство OWNER в одной транзакции; лимит запросов |
| `POST /auth/login` | — | `{email, password}` | `AuthResponse` | одинаковый ответ на «нет пользователя» и «неверный пароль»; лимит запросов |
| `GET /auth/me` | любой | — | `{user, memberships}` | |
| `POST /auth/password-reset/request` | — | `{email, lang?: 'kk'\|'ru'\|'en'}` | `204` всегда | письмо со ссылкой, токен хранится хешем, срок жизни 1 ч (допущение) |
| `POST /auth/password-reset/confirm` | — | `{token, newPassword}` | `204` | токен одноразовый; ранее выданные JWT становятся недействительны |
| `POST /auth/invitations/accept` | — или любой | `{token, password?, fullName?}` | `AuthResponse` | новому пользователю нужны `password`, `fullName`; существующему — только токен в авторизованном запросе |

### Фермы и пользователи

| Метод и путь | Права | Запрос | Ответ |
|---|---|---|---|
| `GET /farms` | любой | — | `FarmDto[]` |
| `POST /farms` | O (владелец хотя бы одной фермы) | `{name, description?, timezone?}` | `FarmDto` |
| `GET /farms/:id` | W | — | `FarmDto` |
| `PATCH /farms/:id` | O | `{name?, description?, timezone?, workerCanEditBoundaries?}` | `FarmDto` |
| `GET /farms/:id/members` | O | — | `{members: [{userId,email,fullName,role}], invitations: InvitationDto[]}` |
| `POST /farms/:id/invitations` | O | `{email, lang?}` | `InvitationDto` (письмо через Mailer; срок 7 суток; повторное приглашение отзывает прежнее; уже участник -> 409) |
| `DELETE /farms/:id/invitations/:invId` | O | — | `204` (отзыв) |
| `DELETE /farms/:id/members/:userId` | O | — | `204` («Убрать доступ»; владельца убрать нельзя) |
| `GET /farms/:id/signal-limits` | O | — | `SignalLimitDto[]` |
| `PUT /farms/:id/signal-limits` | O | `SignalLimitDto[]` (`dailyLimit` целое ≥ 1 или null; `unlimited` bool) | `SignalLimitDto[]` |

Приложение: переключатель «Работник может менять границы» (`SettingsScreen`, сейчас по умолчанию `true`) должен быть выключен по умолчанию и читать/писать `workerCanEditBoundaries`.

### Стадо

| Метод и путь | Права | Запрос | Ответ |
|---|---|---|---|
| `GET /animals` | W | `?search&status&penId&species&cursor` | `AnimalDto[]` |
| `GET /animals/:id` | W | — | `AnimalDto` |
| `GET /animals/:id/track` | W | `?from&to` (ISO 8601) `&limit` (целое 1–500, по умолчанию 100; иное -> 400); возвращает последние `limit` точек по возрастанию времени | `{animal, points: [{lat,lng,accuracyM,at,isOutside}]}` |
| `GET /animals/:id/events` | W | `?limit` (1–100, по умолчанию 20) | `{alerts: AlertDto[], signals: <как в /signals>}` |
| `POST /animals` | W | `{name, tag, species, gender?, breed?, birthDate?(ISO), photoUrl?(http/https), penId?, collarId?}` | `AnimalDto`; `tag` уникален в пределах фермы |
| `PATCH /animals/:id` | W | любое из полей создания | `AnimalDto`; `penId` меняет только B |
| `DELETE /animals/:id` | W (допущение: удаление животного не ограничено; **открытый вопрос владельцу**) | — | `204` |
| `POST /animals/:id/assign-collar` | W | `{deviceId}` | `AnimalDto`; ошейник должен быть в этой же ферме; прежняя привязка снимается; `409`, если занят другим животным |
| `POST /animals/:id/unassign-collar` | W | — | `AnimalDto` |
| `POST /animals/steer` | B | `{animalIds: string[], targetPenId: string}` | `{updated: number, skippedOffline: string[]}`; `penId` меняется у всех выбранных (чужое животное или загон -> 404, ничего не записывается); `skippedOffline` — id животных без ошейника или с ошейником офлайн: они обновлены, но новую границу получат только при следующем пинге |

`POST /animals/:id/steer` из README не создаётся: перегон групповой (спека S4), поэтому единый `POST /animals/steer`. Приложение вызова пока не делает, добавит.

Суточные лимиты: при достижении лимита уровня (`SOUND`/`VIBRATION`) сервер не подаёт этот сигнал (`suppressedBy: 'SIGNAL_LIMIT'` в ответе пинга) и создаёт одно оповещение `SIGNAL_LIMIT_REACHED` на животное, уровень и сутки. `dailyLimit = null` — не задан (без подавления), целое ≥ 1 — лимит, `0` отклоняется; `unlimited = true` — без подавления. Границы суток — по `Farm.timezone` (по умолчанию Asia/Aqtau, UTC+5). Тестовые сигналы из приложения в счётчик не входят.

Счётчики сигналов за сутки (блок «Сигналы за сутки», A7): `GET /animals/:id/signals` -> `{day, sound:{used,limit|null}, vibration:{…}, impulse:{used:0,limit|null,available:false}}`. Энергия импульса не отдаётся.

### Загоны

| Метод и путь | Права | Запрос | Ответ |
|---|---|---|---|
| `GET /geofences` | W | — | `PenDto[]` |
| `GET /geofences/:id` | W | — | `PenDto` и список `animalIds` (`areaHa` и `animalsCount` считает сервер) |
| `POST /geofences` | B | `{name, color?(#RRGGBB), polygon, animalIds?}` | `PenDto` |
| `PATCH /geofences/:id` | B | `{name?, color?, polygon?, animalIds?}` | `PenDto` |
| `DELETE /geofences/:id` | **O** | — | `204`; животные получают `penId = null` |

Путь `/geofences` сохранён (приложение его уже использует). Полигон проверяется: замкнутое кольцо, ≥ 3 различных вершины, координаты в диапазоне, без самопересечений, площадь > 0.

### Ошейники

| Метод и путь | Права | Запрос | Ответ |
|---|---|---|---|
| `GET /devices` | W | — | `CollarDto[]` |
| `GET /devices/:deviceId` | W | — | `CollarDto` |
| `POST /devices` | W | `{deviceId(3–40: A-Za-z0-9_-), animalId?}` | `{collar: CollarDto, deviceSecret: string}` — секрет **показывается один раз**, на сервере хранится только хеш |
| `POST /devices/:deviceId/rotate-secret` | W | — | `{deviceSecret}` |
| `PATCH /devices/:deviceId` | W | `{animalId?: string\|null}` | `CollarDto` |
| `DELETE /devices/:deviceId` | O | — | `204` |
| `POST /devices/:deviceId/test-signal` | W | `{signal: 'SOUND' \| 'VIBRATION'}` | `202 {commandId}`; ставит команду в очередь, ошейник получит её в ответе на следующий пинг. Значение `IMPULSE` отклоняется (`400`) |

`status` ошейника вычисляется при чтении по времени последнего пинга: `UNASSIGNED` (нет животного), `OFFLINE` (последний пинг старше `OFFLINE_AFTER_MISSED_PINGS` x `NORMAL_PING_INTERVAL_SEC` = 3 x 300 = 900 с, либо ещё не выходил на связь), иначе `ONLINE`. Фоновая проверка раз в минуту создаёт одно `DEVICE_OFFLINE` на животное (нет сигнала дольше порога), пинг закрывает его и создаёт `DEVICE_RESTORED`.

Заменяет `POST /device/trigger`. Приложение (`AnimalProfileScreen`) вызывает сейчас `triggerActuator('QAM-0001', {shock: true})` с зашитым идентификатором: меняется приложение (идентификатор из `collarId` животного, кнопка «Импульс» убирается).

### Оповещения

| Метод и путь | Права | Запрос | Ответ |
|---|---|---|---|
| `GET /alerts` | W | `?status&type&animalId&cursor` | `AlertDto[]` |
| `GET /alerts/stats` | W | — | `{activeTotal, activeBreaches, offline}` (без battery); `offline` = активные `DEVICE_OFFLINE` |
| `PATCH /alerts/:id/status` | W | `{status}` | `AlertDto` |
| `POST /alerts/read-all` | W | — | `{updated}` |

README указывает `PUT /alerts/:id/resolve`: не создаётся, остаётся `PATCH :id/status`.

### Аналитика и служебное

| Метод и путь | Права | Ответ |
|---|---|---|
| `GET /analytics/overview` | W | счётчики без `lowBatteryDevices` |
| `GET /health` (вне префикса) | — | `{status, timestamp}` |
| `GET /` | — | `{status, service, version, telemetryEndpoint}`; ссылка `dashboard` удалена (URL не проверен) |

### Камера (если владелец оставит модуль, см. план)

`POST /camera/request-photo` (W), `GET /camera/snapshots` (W), `GET /camera/snapshots/:id/image` (W, с проверкой фермы, заголовок `Content-Type` по реальному формату, `X-Content-Type-Options: nosniff`). Публичный маршрут `/camera/snapshots/image/:fileName` удаляется.

### Симулятор (только `NODE_ENV !== 'production'`)

`POST /mock/inject-telemetry`, `/mock/simulate-breach`, `/mock/simulate-return`, `/mock/inject-photo`: права W, работают только с ошейниками `isSimulated = true`, в production маршруты не существуют (модуль не подключается).

## 4. Эндпоинты ошейника (Д)

| Метод и путь | Запрос | Ответ |
|---|---|---|
| `POST /device/telemetry` | `{deviceId, timestamp(ISO, не старше 10 мин и не позже +2 мин), latitude, longitude, accuracy, signal?(−130…0 dBm), speedKmh?(0–300), hdop?(0–99), satellites?(0–64)}` — **без `battery`**; `timestamp` — ISO 8601 с часовым поясом, окно задаётся `TELEMETRY_MAX_AGE_SEC` (600) и `TELEMETRY_MAX_FUTURE_SEC` (120) | см. ниже |
| `GET /camera/commands?deviceId` | — | `{hasCommand, commandId?, command?, payload?}` |
| `POST /camera/upload` | multipart `image` (≤ 1 МБ, JPEG/PNG по сигнатуре) | `{success, snapshotId}` |

Ответ телеметрии (убраны `shock`, `shockDurationMs`, числа импульса, эмодзи и «400кВ» из `warningMessage`):

```ts
{ success: true, serverTime, nextInterval, configVersion,
  zone: 'GREEN'|'YELLOW'|'ORANGE'|'RED'|'ESCAPE'|'UNKNOWN',
  inFence: boolean | null,            // null = граница не задана или координаты ненадёжны
  distanceToBorderMeters: number | null,
  toneFrequencyHz: number, sound: boolean, vibrate: boolean, vibrateDurationMs: number,
  suppressedBy?: 'SIGNAL_LIMIT' | null,
  command?: { id, type: 'TEST_SOUND' | 'TEST_VIBRATION' } }
```

Зона `UNKNOWN` (fail-closed): граница не задана или некорректна, либо точность GPS хуже 35 м; все исполнительные выключены, `inFence = null`, положение животного всё равно сохраняется; при плохой точности создаётся оповещение `GPS_LOST`. Поле `buzzer` (дубль `sound`) удаляется. Прошивки пока нет (`esp/` содержит только README), поэтому изменение не ломает существующий код. Ошибки: неизвестный `deviceId` и неверный секрет дают одинаковый `401`; неверный `timestamp` — `400`.

**Удаляются** эндпоинты без авторизации: `POST /device/trigger`, `POST|GET /device/buzzer[/:id]`, `GET /device/status[/:id]`. Статус ошейника для людей отдаёт `GET /devices/:deviceId`.

## 5. Что нужно подтвердить

См. раздел «Решения владельца» в [плане](../plans/backend-hardening.md): удаление животного, часовой пояс фермы, поведение при достижении лимита сигналов, судьба модуля камеры.
