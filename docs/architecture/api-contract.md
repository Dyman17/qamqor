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
- Авторизация приложения: `Authorization: Bearer <JWT>`. Идентификация ошейника: 8-значный код устройства (`code`, цифры), см. [device-code-protocol.md](device-code-protocol.md); секрета у ошейника нет.
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
  dataMode: 'REAL' | 'MANUAL' | 'AUTO';                     // режим данных (демо-режимы), по умолчанию 'REAL'
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
  isDemo: boolean;                            // демо-животное (удаляется при возврате фермы в REAL)
}
interface CollarDto {
  deviceId; status: ConnState; animalId: string | null; animalName: string | null;
  signalRssi: number | null; firmwareVersion: string | null; lastSeenAt: string | null;
  code: string | null;                           // 8-значный код ESP32 (null у демо-ошейников и старых записей)
  isDemo: boolean;                               // = Device.isSimulated
}                                                // нет battery, нет secret
interface PenDto {
  id; farmId; name; color: string; polygon: GeoJSONPolygon; animalsCount: number; areaHa: number; // areaHa считает сервер
  isDemo: boolean;                              // демо-загон «Демо-пастбище» (создаётся, только если у фермы нет загонов)
}
interface AlertDto {
  id; type: 'GEOFENCE_BREACH' | 'GEOFENCE_RETURN' | 'DEVICE_OFFLINE' | 'DEVICE_RESTORED' | 'SIGNAL_LIMIT_REACHED' | 'GPS_LOST';
  severity: 'INFO' | 'WARNING' | 'CRITICAL'; status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  animalId: string | null; animalName: string | null; penName: string | null;
  message: string; lat: number | null; lng: number | null; createdAt: string; isRead: boolean;
  isDemo: boolean;                              // оповещение демо-животного; наружу (почта и т. п.) не отправляется никогда
}
interface InvitationDto { id; email; status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'; expiresAt; }

// Демо-режимы фермы (см. docs/plans/pilot-modes.md)
interface SimulationDto {
  dataMode: 'REAL' | 'MANUAL' | 'AUTO';
  running: boolean;                 // AUTO и до simUntil
  speed: 1 | 2 | 5 | 10; herd: number;
  until: string | null;             // ISO, автостоп (только в AUTO)
  demo: { animals: number; alerts: number };
  enabled: boolean;                 // DEMO_MODES_ENABLED
}
interface CollarResponseDto {       // то, что получил бы ошейник на этот пинг
  zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';
  inFence: boolean | null; distanceToBorderMeters: number | null;
  sound: boolean; vibrate: boolean; toneFrequencyHz: number; suppressedBy: 'SIGNAL_LIMIT' | null;
}
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
| `POST /auth/password-reset/request` | — | `{email, lang?: 'kk'\|'ru'\|'en'}` | `204` всегда; `503 {code: 'MAIL_NOT_CONFIGURED'}`, если нет настоящего почтового транспорта (проверяется до поиска пользователя) | письмо со ссылкой, токен хранится хешем, срок жизни 1 ч (допущение) |
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
| `POST /farms/:id/invitations` | O | `{email, lang?}` | `InvitationDto & {delivered: boolean, inviteUrl?: string}`; без настоящего почтового транспорта (или при сбое отправки) письмо не уходит, `delivered: false`, и владелец получает `inviteUrl` для передачи вручную (письмо через Mailer; срок 7 суток; повторное приглашение отзывает прежнее; уже участник -> 409) |
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

Оповещения `GEOFENCE_BREACH`, `GPS_LOST`, `DEVICE_OFFLINE` не создаются повторно, пока оповещение с тем же ключом `ACTIVE` или `ACKNOWLEDGED`; заново они взводятся только после того, как условие исчезло (`RESOLVED`). Снятие ошейника и удаление животного закрывают его открытые `DEVICE_OFFLINE` и `GPS_LOST`. Пинг с `timestamp` не новее `lastSeenAt` животного не двигает его, повтор `(deviceId, timestamp)` не пишется и не считается в лимитах. JWT, выданные не позже смены пароля (с точностью до секунды), недействительны.

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
| `POST /devices` | **O** | `{code(8 цифр, ^[0-9]{8}$), animalId?}`: владелец «принимает» ошейник по коду. Устаревший вариант `{deviceId(3–40: A-Za-z0-9_-), animalId?}` ещё принимается | `{collar: CollarDto}` (`deviceId = QAM-<code>`, секрета нет). Код уникален в системе: повтор -> `409` (одинаковый ответ, чей бы он ни был). Устаревший вариант возвращает `deviceSecret` один раз, но по нему ошейник пинговать не может |
| `POST /devices/:deviceId/rotate-secret` | **O** | — | `{deviceSecret}` (устарело, на телеметрию не влияет) |
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
| `GET /health` (вне префикса) | — | `{status, timestamp, mail: 'none' \| 'configured'}` (`none` — письма не доставляются) |
| `GET /` | — | `{status, service, version, telemetryEndpoint}`; ссылка `dashboard` удалена (URL не проверен) |

### Камера (модуль отключён)

Решение владельца 2026-11-08: до появления железа модуль камеры **не подключён** (`CameraModule` не входит в `AppModule`), маршрутов `/camera/*` на сервере нет. Код оставлен и усилен на случай подключения: только JPEG/PNG по сигнатуре, до 1 МБ (413 при превышении), случайное имя файла, отдача только `GET /camera/snapshots/:id/image` с JWT и проверкой фермы (`nosniff`, `inline`), публичный маршрут по имени файла удалён, SVG-заглушки нет, `photoUrl` животного автоматически не подставляется.

### Режимы данных: Реальный / Ручной (пилот) / Авто (симуляция)

Заменяют dev-only `/mock/*` (удалён вместе с `MockModule`). Доступны во всех окружениях, включая production; переменная `DEMO_MODES_ENABLED` (по умолчанию `true`): при `false` все маршруты ниже, кроме `GET /farms/:id/simulation`, отвечают `404`, а чтение отдаёт `enabled: false`; симулятор не стартует. Настоящие ошейники работают в любом режиме без изменений, их данные никогда не помечаются демо.

| `dataMode` | Смысл | Ручные вызовы | Симулятор |
|---|---|---|---|
| `REAL` (по умолчанию) | только настоящие ошейники; демо-данных нет | `409` | выключен |
| `MANUAL` | пилот: владелец сам ставит демо-животных и запускает события | разрешены (O) | выключен |
| `AUTO` | сервер ведёт демо-стадо по сценарию | `409` («остановите симуляцию») | работает |

Переходы: `REAL -> MANUAL | AUTO`, `MANUAL <-> AUTO` (демо-данные сохраняются), `MANUAL | AUTO -> REAL` (**демо-данные удаляются**: демо-животные, их ошейники `QAM-DEMO-xxxx`, демо-загон, оповещения, телеметрия и события сигналов; реальные записи не затрагиваются). Менять режим и вводить данные может только владелец; работник видит режим, метки `isDemo` и читает состояние.

| Метод и путь | Права | Запрос | Ответ |
|---|---|---|---|
| `GET /farms/:id/simulation` | W | — | `SimulationDto`; отмечает, что ферму смотрят (см. ниже); если время AUTO вышло, переводит ферму в `MANUAL` |
| `PUT /farms/:id/data-mode` | O | `{mode: 'REAL' \| 'MANUAL' \| 'AUTO'}` | `SimulationDto`; `AUTO` = `start` с текущими `simSpeed`/`simHerd`, автостоп через 2 ч; `REAL` удаляет демо-данные; тот же режим -> без изменений |
| `POST /farms/:id/simulation/start` | O | `{speed?: 1\|2\|5\|10, herd?: 1..20, hours?: 1..8}` | `200 SimulationDto`; режим `AUTO`, создаёт недостающих демо-животных (при меньшем `herd` лишние удаляются) |
| `POST /farms/:id/simulation/stop` | O | — | `200 SimulationDto`; режим `MANUAL`, демо-данные остаются; в `REAL` -> `409` |
| `POST /farms/:id/simulation/reset` | O | — | `200 SimulationDto`; удаляет демо-оповещения, телеметрию и события сигналов, возвращает демо-животных внутрь загона, сценарий начинается заново; в `REAL` -> `409` |
| `PATCH /farms/:id/simulation` | O | `{speed?}` | `SimulationDto` (скорость на лету); в `REAL` -> `409` |
| `POST /farms/:id/simulate/animals` | O, MANUAL | `{name?, species?}` | `201 AnimalDto` (демо-животное `D-001…` + симулированный ошейник `QAM-DEMO-xxxx` у загона фермы; не больше 20 на ферму -> `409`) |
| `POST /farms/:id/simulate/telemetry` | O, MANUAL | `{animalId, lat, lng, accuracyM?(по умолчанию 5), speedKmh?}` | `200 CollarResponseDto` |
| `POST /farms/:id/simulate/events` | O, MANUAL | `{animalId, event}` | `200 CollarResponseDto` или `{ok: true}` (`COLLAR_OFFLINE`) |

События `event` (все идут через тот же `TelemetryService.processDeviceTelemetry`, то есть через настоящую логику зон, суточных лимитов и оповещений):

- `BREACH`: точка около 30 м снаружи ближайшей границы (зона RED, звук и вибрация, `GEOFENCE_BREACH`);
- `ESCAPE`: точка более 100 м (около 150 м) снаружи (зона ESCAPE, сигналы выключены);
- `RETURN`: самая глубокая точка загона (`GEOFENCE_RETURN`);
- `GPS_LOST`: пинг с точностью 80 м (зона UNKNOWN, `GPS_LOST`);
- `COLLAR_OFFLINE`: `lastHeartbeatAt` ошейника сдвигается на `порог + 60 с` назад и запускается настоящая проверка `OfflineWatcherService` для этого ошейника (`DEVICE_OFFLINE`);
- `COLLAR_ONLINE`: пинг в последней позиции (закрывает `GPS_LOST`/`DEVICE_OFFLINE`, создаёт `DEVICE_RESTORED`).

Ошибки: `403 FORBIDDEN_ROLE` у работника на любой мутации; `409 CONFLICT`: вызов не в том режиме, привязка демо к реальному (и наоборот: ошейник `isSimulated` только демо-животному), 21-е демо-животное, нет загона с корректной границей; `404 NOT_FOUND`: чужое, реальное или несуществующее животное (ручные вызовы работают **только** с `isDemo` животными и `isSimulated` ошейниками); `400 VALIDATION`: координаты вне диапазона, `speed`/`herd`/`hours` вне границ, неизвестное событие; `429 RATE_LIMITED`: ручные вызовы `simulate/*` 60 в минуту на пользователя.

Загон демо-животных: всегда собственный демо-загон «Демо-пастбище» (`isDemo`); это копия полигона самого старого настоящего загона фермы, а если загонов нет, прямоугольник 600 x 400 м (центр 43.650, 51.157, Актау, допущение владельца). Настоящий загон никогда не используется напрямую и не удаляется; демо-загон, в который перенесли настоящее животное, при возврате в `REAL` не удаляется, а становится обычным. Привязка: реальное животное не берёт демо-ошейник, демо-животное не берёт реальный (`409` в `POST/PATCH /animals`, `assign-collar`, `PATCH/POST /devices`).

Сценарий `AUTO` (цикл около 6 мин): пастьба внутри загона (в том числе невыпуклого) -> приближение к границе (GREEN -> YELLOW -> ORANGE) -> с вероятностью 70 % разворот, с 30 % побег (RED, `GEOFENCE_BREACH`, затем ESCAPE и возврат с `GEOFENCE_RETURN`); вставки `GPS_LOST` и «ошейник молчит» (не чаще одной каждого вида за 8-10 мин на ферму). Первые четыре животных играют роли, которые гарантируют показ всех событий за первые ~4 минуты (разворот, побег, потеря GPS, нет связи). Суточные лимиты сигналов действуют как у настоящих животных. **Честная оговорка:** порог «ошейник молчит» в сценарии сжат с 15 минут до ~90 с (`SIM_DEMO_OFFLINE_SEC`) только для живого показа; для настоящих ошейников порог прежний.

Гонки: действия владельца всегда побеждают тик. Возврат в `REAL` сначала переключает режим (тик уступает после текущего животного), затем ждёт аренду до 15 с и удаляет демо-данные (`409` только если тик не отпустил ферму за 15 с; повтор `PUT data-mode REAL` доделывает очистку). Первый `start` (не из `AUTO`) берёт аренду так же и включает `AUTO` только после того, как стадо создано. `start` и `PATCH` на уже идущей симуляции — обычное обновление без аренды (`speed`, `herd`, `until`); лишних животных при уменьшении `herd` удаляет следующий тик. Стадо создаётся пакетно (два `createMany` в одной транзакции). Фермы в `MANUAL` чистятся при чтении `GET /farms/:id/simulation` (не чаще раза в 5 мин, срок хранения 24 ч). Устаревшие симулированные ошейники `QAM-MOCK-*` удаляются при очистке (реальные не затрагиваются).

Нагрузка и стоимость: тик раз в `SIM_TICK_SEC` (10 с), животные пингуются последовательно (около 8 запросов к БД на пинг). Ферма обрабатывается только пока кто-то опрашивает `GET /farms/:id/simulation` (окно 3 мин, клиент опрашивает раз в 15 с, пока вкладка видима); без зрителей тик не делает ни одного обращения к БД. Аренда тика хранится в `Farm.simLeaseUntil` (30 с, снимается после тика). Автостоп: `simUntil` (по умолчанию 2 ч, максимум 8 ч) переводит ферму в `MANUAL`. Демо-телеметрия старше 30 мин, события сигналов старше 2 ч и решённые демо-оповещения старше 1 ч удаляются раз в 5 мин, демо-оповещений не больше 200 на ферму.

## 4. Эндпоинты ошейника (Д)

| Метод и путь | Запрос | Ответ |
|---|---|---|
| `POST /device/telemetry` | `{code(8 цифр), timestamp(ISO, не старше 10 мин и не позже +2 мин), latitude, longitude, accuracy, signal?(−130…0 dBm), speedKmh?(0–300), hdop?(0–99), satellites?(0–64)}` — **без `battery`, без секрета**; код можно передать и заголовком `X-Device-Code` (тело и заголовок должны совпадать); `timestamp` — ISO 8601 с часовым поясом, окно задаётся `TELEMETRY_MAX_AGE_SEC` (600) и `TELEMETRY_MAX_FUTURE_SEC` (120) | см. ниже |

**Протокол кода (решение владельца 2026-11-09).** Идентичность ESP32 — 8-значный код из прошивки. Сервер принимает пинг только от кода, который владелец «принял» (`POST /devices {code}`); неизвестный, не принятый или неверного формата код даёт `401`, ничего не сохраняется. **Каждый ответ, в том числе ошибка, содержит `code`, равный коду запроса; прошивка принимает ответ только при совпадении.** В ответах-ошибках на этом маршруте поле `code` занято кодом устройства (или `null`, если в запросе нет корректного кода), а вид ошибки лежит в `error` (`UNAUTHENTICATED`, `VALIDATION`, `RATE_LIMITED`).

Лимиты запросов: до 300 в минуту на IP и до 30 в минуту на код (`429`, `retryAfterSec`); проверяются до поиска кода, чтобы замедлить перебор. Известный риск: код не секрет, любой, кто знает принятый код, может слать ложные позиции (10^8 вариантов, перебор замедлен лимитом). Усиление позже: необязательный секрет на устройство или HMAC тела.

Пример для прошивки:

```http
POST /api/v1/device/telemetry
Content-Type: application/json

{"code":"12345678","timestamp":"2026-11-09T08:15:30Z","latitude":43.65012,"longitude":51.15731,"accuracy":6.5,"signal":-71,"speedKmh":1.2}
```

```json
{"success":true,"code":"12345678","serverTime":"2026-11-09T08:15:31.204Z","nextInterval":300,"configVersion":1,
 "inFence":true,"zone":"YELLOW","distanceToBorderMeters":14.3,"toneFrequencyHz":1124,
 "sound":true,"vibrate":false,"vibrateDurationMs":0,"suppressedBy":null,
 "warningMessage":"Zone YELLOW: warning, 14.3 m to the border. Sound signal (1124 Hz)."}
```

Ошибка (код не принят):

```json
{"statusCode":401,"code":"87654321","error":"UNAUTHENTICATED","message":"Invalid device credentials"}
```

Ответ телеметрии (убраны `shock`, `shockDurationMs`, числа импульса, эмодзи и «400кВ» из `warningMessage`):

```ts
{ success: true, code, serverTime, nextInterval, configVersion,
  zone: 'GREEN'|'YELLOW'|'ORANGE'|'RED'|'ESCAPE'|'UNKNOWN',
  inFence: boolean | null,            // null = граница не задана или координаты ненадёжны
  distanceToBorderMeters: number | null,
  toneFrequencyHz: number, sound: boolean, vibrate: boolean, vibrateDurationMs: number,
  suppressedBy?: 'SIGNAL_LIMIT' | null,
  command?: { id, type: 'TEST_SOUND' | 'TEST_VIBRATION' } }
```

Зона `UNKNOWN` (fail-closed): граница не задана или некорректна, либо точность GPS хуже 35 м; все исполнительные выключены, `inFence = null`, положение животного всё равно сохраняется; при плохой точности создаётся оповещение `GPS_LOST`. Поле `buzzer` (дубль `sound`) удаляется. Прошивки пока нет (`esp/` содержит только README), поэтому изменение не ломает существующий код. Ошибки: неизвестный, не принятый и некорректный код дают одинаковый `401`; неверный `timestamp` или тело — `400`; превышение лимита — `429`.

**Удаляются** эндпоинты без авторизации: `POST /device/trigger`, `POST|GET /device/buzzer[/:id]`, `GET /device/status[/:id]`. Статус ошейника для людей отдаёт `GET /devices/:deviceId`.

## 5. Что нужно подтвердить

См. раздел «Решения владельца» в [плане](../plans/backend-hardening.md): удаление животного, часовой пояс фермы, поведение при достижении лимита сигналов, судьба модуля камеры.
