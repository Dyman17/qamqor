Status: draft (обновлено 2026-11-10: ритм пингов, эпизодические сигналы, защита чтения телеметрии, rotate-secret удалён)

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
  lastHeartRate: number | null; lastHeartRateAt: string | null;   // пульс, уд/мин (null = не измерялся)
  status: AnimalStatus;
  isDemo: boolean;                            // демо-животное (удаляется при возврате фермы в REAL)
  controlMode: 'AUTO' | 'GPS_MANUAL' | 'MANUAL' | null;  // режим ошейника животного (null = нет ошейника)
  positionSource: 'GPS' | 'MANUAL';           // MANUAL = позицию задал оператор (ошейник в GPS_MANUAL)
  controlModeSince: string | null;            // с какого момента включён ручной режим (null в AUTO)
  controlModeExpiresAt: string | null;        // когда он сам вернётся в AUTO без действий оператора (null в AUTO)
}
interface CollarDto {
  deviceId; status: ConnState; animalId: string | null; animalName: string | null;
  signalRssi: number | null; firmwareVersion: string | null; lastSeenAt: string | null;
  code: string | null;                           // 8-значный код ESP32 (null у демо-ошейников и старых записей)
  isDemo: boolean;                               // = Device.isSimulated
  controlMode: 'AUTO' | 'GPS_MANUAL' | 'MANUAL'; // режим управления реальным ошейником, по умолчанию AUTO
  positionSource: 'GPS' | 'MANUAL';              // MANUAL только в GPS_MANUAL
  controlModeSince: string | null;               // с какого момента включён ручной режим (null в AUTO)
  controlModeExpiresAt: string | null;           // когда он сам вернётся в AUTO (для постоянной плашки «ручной режим»)
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
| `POST /devices` | **O** | `{code(8 цифр, ^[0-9]{8}$), animalId?}`: владелец «принимает» ошейник по коду. Устаревший вариант `{deviceId(3–40: A-Za-z0-9_-), animalId?}` ещё принимается | `{collar: CollarDto}` (`deviceId = QAM-<code>`, секрета нет). Код уникален в системе: если код уже принадлежит какой-либо ферме -> `409` (одинаковый ответ, чья бы она ни была). Если ошейник с этим кодом уже присылал пинги (запись без фермы, см. «Протокол кода»), она **присоединяется к ферме** с сохранением истории телеметрии, `409` нет. Устаревший вариант возвращает `deviceSecret` один раз, но по нему ошейник пинговать не может |
| `PATCH /devices/:deviceId` | W | `{animalId?: string\|null}` | `CollarDto` |
| `DELETE /devices/:deviceId` | O | — | `204` |
| `POST /devices/:deviceId/test-signal` | W | `{signal: 'SOUND' \| 'VIBRATION'}` | `202 {commandId}`; ставит команду в очередь, ошейник получит её в ответе на следующий пинг. Значение `IMPULSE` отклоняется (`400`) |
| `PATCH /devices/:deviceId/control-mode` | **O** для `MANUAL` / `GPS_MANUAL`, W для `AUTO` | `{mode: 'AUTO' \| 'GPS_MANUAL' \| 'MANUAL'}` | `CollarDto`. Только реальный (не демо) ошейник, привязанный к животному, иначе `409`; чужой или неизвестный -> `404`. Выход из `GPS_MANUAL` стирает ручную позицию. Лимит 30/мин на пользователя |
| `PUT /devices/:deviceId/manual-position` | **O** | `{latitude(-90…90), longitude(-180…180)}` | `200 {deviceId, controlMode:'GPS_MANUAL', positionSource:'MANUAL', position:{latitude, longitude, at}, zone, inFence, distanceToBorderMeters}`. `409`, если режим не `GPS_MANUAL` (или ошейник демо / без животного). Лимит 120/мин на пользователя (перетаскивание) |

**Режимы управления реальным ошейником.** `AUTO` (по умолчанию): как раньше, позиция и зона по GPS ошейника, автоматические сигналы. `MANUAL` («Ручной»): позиция по реальному GPS (показ и оповещения как обычно), но сервер **не** подаёт автоматические зональные сигналы (`sound`/`vibrate` = `false`, `toneFrequencyHz` = 0); ошейник получает только поставленные оператором команды (`test-signal`). `GPS_MANUAL` («GPS вручную»): оператор перетаскивает точку животного на карте; сервер использует эту точку вместо GPS для зоны, оповещений и зональных сигналов в ответе на пинг реальному ESP (точность 0, скорость 0 для правила ESCAPE). Реальный GPS по-прежнему пишется в строку телеметрии, но животное не двигает и оповещений GPS не вызывает; пульс настоящий. Без ручной позиции (режим только что включён) зона `UNKNOWN`, сигналов нет.

**`MANUAL` не отключает оповещения:** позиция по реальному GPS по-прежнему создаёт `GEOFENCE_BREACH`, `GPS_LOST` и т. д. (на карте и в списке оповещений), без звука и вибрации на ошейнике. Поэтому ручные режимы может включать только владелец (`403 FORBIDDEN_ROLE` у работника); вернуть `AUTO` может любой член фермы.

**Автовозврат в `AUTO`.** `MANUAL` / `GPS_MANUAL` возвращаются в `AUTO` сами, если с последнего действия оператора (смена режима, `PUT manual-position`, `test-signal` для этого ошейника) прошло `CONTROL_MODE_TTL_MIN` минут (по умолчанию 120, положительное целое; проверяется при старте). Возврат делает фоновая проверка (раз в `OFFLINE_CHECK_INTERVAL_SEC`) и, лениво, следующий пинг ошейника; ручная точка стирается. `controlModeSince` и `controlModeExpiresAt` в `CollarDto` / `AnimalDto` позволяют показывать постоянную плашку «ручной режим» со временем окончания. При выходе из `GPS_MANUAL` (вручную или по сроку) позиция животного возвращается к последнему надёжному реальному фиксу из телеметрии (или `lastSeenAt` сбрасывается), чтобы первый реальный пинг не сочли устаревшим.

`PUT .../manual-position` при каждом вызове: вычисляет зону по активному загону животного, обновляет `lastLatitude/lastLongitude/lastAccuracy(0)/lastSeenAt/isOutsideGeofence`, создаёт или закрывает `GEOFENCE_BREACH` (только при переходе внутри/снаружи; повторную проверку делает пинг), рассылает SSE-событие по ферме (все открытые карты двигаются). **Сигналы здесь не ставятся в очередь и не подаются**: они уходят только в ответе на пинг ошейника (при открытом дашборде ферма «живая», пинг раз в секунду, поэтому звук приходит за 1–2 с). Событие потока и ответ ошейника содержат `controlMode`; событие потока ещё `positionSource` (`MANUAL` у `GPS_MANUAL`, позиция в нём точка оператора).

**Эскалация сигнала (с гистерезисом).** В `AUTO` и `GPS_MANUAL` вход в зону БОЛЕЕ тяжёлую, чем любая уже достигнутая в текущем «эпизоде» (YELLOW -> ORANGE -> RED), подаёт сигналы зоны сразу, даже внутри паузы `SIGNAL_COOLDOWN_SEC` (они записываются и идут в суточный лимит). Эпизод хранится на животное в памяти процесса и заканчивается, только когда животное было в GREEN непрерывно `ESCALATION_RESET_SEC` секунд (по умолчанию 60, 0 допустим): одиночный GREEN, пинг с плохой точностью (UNKNOWN) и дрожание GPS на линии зоны эпизод не сбрасывают, поэтому возвраты YELLOW/GREEN не дают сигнал на каждый вход, а повторяют его не чаще раза за паузу. Первый пинг животного (в том числе после рестарта) только открывает эпизод и подчиняется обычной паузе (она берётся из базы).

**Доставка команд.** Команда из очереди (`test-signal`) остаётся `PENDING` после первой отдачи и повторно отдаётся с тем же `id`, пока не была отдана дважды или с первой отдачи не прошло 20 с, затем становится `EXECUTED`; прошивка игнорирует повторный `id`. Так ответ, потерянный по таймауту клиента, не теряет команду. Колонки `DeviceCommand.deliveredAt`, `deliveryCount`. Прошивка помнит последний `id` команды только в RAM: перезагрузка между двумя отдачами может один раз повторить тестовую команду.

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
| `POST /farms/:id/simulate/telemetry` | O, MANUAL | `{animalId, lat, lng, accuracyM?(по умолчанию 5), speedKmh?, heartRate?(20–250, по умолчанию покой 48–70)}` | `200 CollarResponseDto` |
| `POST /farms/:id/simulate/events` | O, MANUAL | `{animalId, event}` | `200 CollarResponseDto` или `{ok: true}` (`COLLAR_OFFLINE`) |

**`POST /animals` в режимах `MANUAL` и `AUTO`.** Обычная форма создаёт демо-животное: `isDemo: true` в ответе (форма ответа прежняя) и автоматически привязанный симулированный ошейник `QAM-DEMO-xxxxxx`. Загон: переданный `penId` сохраняется только если это демо-загон фермы, иначе (в том числе реальный загон, он не трогается) берётся демо-загон фермы (создаётся при необходимости); животное появляется внутри загона. `collarId` в этих режимах -> `409`; не больше 20 демо-животных на ферму -> `409`; повтор бирки -> `409`. В `REAL` форма работает как раньше (реальное животное). Такое животное принимает `POST /farms/:id/simulate/telemetry` `{animalId, lat, lng}` (подтверждено: поля `accuracyM`, `speedKmh` необязательны) в `MANUAL`, чтобы перетаскивать его по карте; в `AUTO` ручной ввод по-прежнему `409` (сценарий двигает животных сам).

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
| `POST /device/telemetry` | `{code(8 цифр), timestamp(ISO, не старше 10 мин и не позже +2 мин), latitude, longitude, accuracy, signal?(−130…0 dBm), speedKmh?(0–300), hdop?(0–99), satellites?(0–64), heartRate?(целое 20–250 уд/мин или null — нет контакта)}`; **`latitude`, `longitude`, `accuracy` идут только вместе; без GPS-фикса (например в помещении) их можно опустить, тогда `timestamp` тоже необязателен (берётся время сервера)** — **без `battery`, без секрета**; код можно передать и заголовком `X-Device-Code` (тело и заголовок должны совпадать); `timestamp` — ISO 8601 с часовым поясом, окно задаётся `TELEMETRY_MAX_AGE_SEC` (600) и `TELEMETRY_MAX_FUTURE_SEC` (120) | см. ниже |

**Протокол кода (решение владельца 2026-11-09).** Идентичность ESP32 — 8-значный код из прошивки. **Открытый приём (решение владельца, прототип, без аккаунтов у ESP): сервер принимает ЛЮБОЙ корректный 8-значный код.** Первый пинг от неизвестного кода создаёт «непринятое» устройство (`QAM-<code>`, без фермы и животного, `isSimulated=false`), телеметрия сохраняется на нём; ответ `200`: `code`, `nextInterval`, `zone:"UNKNOWN"`, без сигналов, `mode:"REAL"`, `warningMessage:"Device not claimed yet"`. Когда владелец принимает код (`POST /devices {code}`), запись присоединяется к ферме, с этого момента пинг обрабатывается как у принятого ошейника. Некорректный код (не `^[0-9]{8}$`), отсутствие кода или расхождение тела и заголовка `X-Device-Code` -> `400` с `code:null`. Защита от злоупотреблений: лимиты 300/мин на IP и 30/мин на код; не больше 500 непринятых устройств одновременно (сверх -> `429`, `retryAfterSec: 3600`); непринятые устройства без пинга 7 дней удаляются вместе с телеметрией (фоновая задача, раз в `OFFLINE_CHECK_INTERVAL_SEC`). Риск: любой может создавать непринятые записи и подделывать чужой код (см. device-code-protocol.md). **Каждый ответ, в том числе ошибка, содержит `code`, равный коду запроса; прошивка принимает ответ только при совпадении.** В ответах-ошибках на этом маршруте поле `code` занято кодом устройства (или `null`, если в запросе нет корректного кода), а вид ошибки лежит в `error` (`UNAUTHENTICATED`, `VALIDATION`, `RATE_LIMITED`).

Лимиты запросов: до 300 в минуту на IP и до 30 в минуту на код (`429`, `retryAfterSec`); проверяются до поиска кода, чтобы замедлить перебор. Известный риск: код не секрет, любой, кто знает принятый код, может слать ложные позиции (10^8 вариантов, перебор замедлен лимитом). Усиление позже: необязательный секрет на устройство или HMAC тела.

**Ритм пингов (`nextInterval`, секунды).** Сервер говорит ошейнику, когда пинговать снова; прошивка обязана ему следовать.
- Ошейник не принят фермой: `UNCLAIMED_PING_INTERVAL_SEC` (30).
- Принятый ошейник фермы, которую кто-то смотрит в вебе (открыт SSE-поток `GET /device/stream`; ферма остаётся «живой» ещё `LIVE_LINGER_SEC` (120 с) после ухода последнего зрителя): `LIVE_PING_INTERVAL_SEC` (1, допустимо 1–60).
- Иначе: `NORMAL_PING_INTERVAL_SEC` (300). Животное вне загона (RED/ESCAPE) получает `EMERGENCY_PING_INTERVAL_SEC` (60), но не больше живого интервала (берётся минимум).
- Состояние «живой фермы» хранится в памяти процесса (один экземпляр сервера): **на Render должен оставаться ровно 1 экземпляр**, иначе каждый экземпляр знает только своих зрителей и часть ошейников останется на медленном ритме.
- Ошейник, которому сказали спать 300 с, ускоряется до живого ритма только после СВОЕГО следующего пинга: открытый дашборд не может разбудить его раньше (до 5 минут задержки при первом открытии).

**Переменные окружения ритма, сигналов и записи** (все необязательные, указаны значения по умолчанию): `LIVE_PING_INTERVAL_SEC` (1, допустимо 1–60), `LIVE_LINGER_SEC` (120, 0 допустим), `UNCLAIMED_PING_INTERVAL_SEC` (30), `SIGNAL_COOLDOWN_SEC` (30, 0 = пауза выключена), `TELEMETRY_STORE_MIN_SEC` (10, 0 = писать каждый пинг), `ESCALATION_RESET_SEC` (60, 0 допустим), `CONTROL_MODE_TTL_MIN` (120, положительное целое). Уже существовали: `NORMAL_PING_INTERVAL_SEC` (300), `EMERGENCY_PING_INTERVAL_SEC` (60), `TELEMETRY_MAX_AGE_SEC` (600), `TELEMETRY_MAX_FUTURE_SEC` (120), `OFFLINE_AFTER_MISSED_PINGS` (3).

**Сигналы эпизодические.** Для каждого животного и каждого вида (звук, вибрация) сервер подаёт не больше одного сигнала за `SIGNAL_COOLDOWN_SEC` (30 с), как бы часто ни пинговал ошейник. Внутри паузы в ответе `sound`/`vibrate` = `false` (`toneFrequencyHz = 0`, если звука нет), сигнал не записывается и не идёт в суточный лимит, `suppressedBy` остаётся `null` (пауза не подавление). Устаревший пинг (`timestamp` не новее `lastSeenAt`) и повтор не подают и не записывают сигналов. Суточный лимит считает поданные эпизоды.

**Нагрузка на запись.** Строка `Telemetry` пишется не чаще `TELEMETRY_STORE_MIN_SEC` (10 с), а сразу при смене зоны, выходе/возврате, смене GPS_LOST и появлении пульса; поток SSE получает каждый пинг. Строка `Device` (статус, `lastHeartbeatAt`, `signal`) обновляется при смене статуса или раз в 10 с. Фоновый контроль связи при DEVICE_OFFLINE помечает устройство `OFFLINE`; следующий пинг закрывает оповещение. Ненадёжный фикс (зона UNKNOWN, LOW_ACCURACY; прошивка шлёт последнюю позицию с точностью 999) создаёт GPS_LOST, но не перезаписывает позицию и `lastSeenAt` животного. Закрытое пользователем `GEOFENCE_BREACH` не создаётся заново 10 минут, пока животное остаётся вне загона.

**Чтение телеметрии (для веба, не для ошейника).** Оба маршрута требуют `Authorization: Bearer` и `x-farm-id` (как `/devices`); ошибки 401/403 приходят обычным JSON до начала потока.
- `GET /device/telemetry?code=<8 цифр>&limit=`: последние сырые пакеты ошейника **своей фермы**. `code` обязателен (иначе `400`); чужой или неизвестный код -> `404`. Лимит запросов 60/мин на пользователя. Поле `signalRssi` берётся из `Device.signal`.
- `GET /device/stream[?code=&animalId=]` (SSE, `Accept: text/event-stream`): события `{type:'keepalive'|'telemetry', ...}` только устройств своей фермы (непринятые не передаются). EventSource не умеет заголовки, поэтому веб читает поток через `fetch` + `ReadableStream`. Открытый поток делает ферму «живой»; не больше 5 потоков на пользователя (`429`). Поток завершается сервером, когда истекает JWT (`exp`) и на первом keepalive (раз в 15 с) после того, как пользователь перестал быть членом фермы; зритель и слот потока при этом освобождаются, клиент должен переподключиться (при истёкшем токене нужен новый вход). Пульс в событии: значение этого пинга или сохранённое не старше 120 с, иначе `heartRate: null`, `pulseThreat.level = UNKNOWN`.

`POST /devices` (принять ошейник по коду) ограничен: 10/мин и 60/час на пользователя, 30/мин на IP. Маршрут `POST /devices/:id/rotate-secret` удалён (ошейник авторизуется кодом, секрет ничего не проверял); модуль камеры с `DeviceSecretAuthGuard` и колонка `secretHash` не тронуты.

Пример для прошивки:

```http
POST /api/v1/device/telemetry
Content-Type: application/json

{"code":"12345678","timestamp":"2026-11-09T08:15:30Z","latitude":43.65012,"longitude":51.15731,"accuracy":6.5,"signal":-71,"speedKmh":1.2,"satellites":9,"heartRate":64}
```

```json
{"success":true,"mode":"REAL","code":"12345678","serverTime":"2026-11-09T08:15:31.204Z","nextInterval":300,"configVersion":1,
 "inFence":true,"zone":"YELLOW","distanceToBorderMeters":14.3,"toneFrequencyHz":1124,
 "sound":true,"vibrate":false,"vibrateDurationMs":0,"suppressedBy":null,
 "warningMessage":"Zone YELLOW: warning, 14.3 m to the border. Sound signal (1124 Hz)."}
```

Пульс без GPS-фикса (ошейник в помещении):

```json
{"code":"12345678","heartRate":66,"satellites":0}
```

```json
{"success":true,"mode":"PILOT","code":"12345678","serverTime":"2026-11-09T08:15:31.204Z","nextInterval":300,"configVersion":1,
 "inFence":null,"zone":"UNKNOWN","distanceToBorderMeters":null,"toneFrequencyHz":0,
 "sound":false,"vibrate":false,"vibrateDurationMs":0,"suppressedBy":null,
 "warningMessage":"Zone UNKNOWN: no GPS fix. No signals."}
```

Без фикса сервер только сохраняет пульс (`Animal.lastHeartRate/lastHeartRateAt`, строка телеметрии с пустыми координатами) и отмечает ошейник онлайн; зона `UNKNOWN`, сигналов нет, оповещение `GPS_LOST` не создаётся (оно остаётся только для плохой точности при наличии координат). Точки без координат в `GET /animals/:id/track` не попадают.

**Режим данных для ошейника.** Каждый успешный ответ содержит `mode`: `"REAL"`, `"PILOT"` (ферма в `MANUAL`) или `"AUTO"`. Ошейник всегда шлёт GPS и пульс независимо от режима; `mode` нужен ему для индикации.

Ответ на пинг непринятого кода (тот же вид, что «без фикса», `warningMessage` = `Device not claimed yet`, `mode` = `REAL`).

Ошибка (некорректный код):

```json
{"statusCode":400,"code":null,"error":"VALIDATION","message":"code: exactly 8 digits are required"}
```

Ответ телеметрии (убраны `shock`, `shockDurationMs`, числа импульса, эмодзи и «400кВ» из `warningMessage`):

```ts
{ success: true, mode: 'REAL'|'PILOT'|'AUTO', code, serverTime, nextInterval, configVersion,
  zone: 'GREEN'|'YELLOW'|'ORANGE'|'RED'|'ESCAPE'|'UNKNOWN',
  inFence: boolean | null,            // null = граница не задана или координаты ненадёжны
  distanceToBorderMeters: number | null,
  toneFrequencyHz: number, sound: boolean, vibrate: boolean, vibrateDurationMs: number,
  suppressedBy?: 'SIGNAL_LIMIT' | null,
  command?: { id, type: 'TEST_SOUND' | 'TEST_VIBRATION' } }
```

Зона `UNKNOWN` (fail-closed): граница не задана или некорректна, либо точность GPS хуже 35 м; все исполнительные выключены, `inFence = null`, положение животного всё равно сохраняется; при плохой точности создаётся оповещение `GPS_LOST`. Поле `buzzer` (дубль `sound`) удаляется. Прошивки пока нет (`esp/` содержит только README), поэтому изменение не ломает существующий код. Ошибки: некорректный код, неверный `timestamp` или тело — `400`; `401` остаётся только для редкого случая, когда запись с кодом не удалось ни найти, ни создать; превышение лимита — `429`.

**Удаляются** эндпоинты без авторизации: `POST /device/trigger`, `POST|GET /device/buzzer[/:id]`, `GET /device/status[/:id]`. Статус ошейника для людей отдаёт `GET /devices/:deviceId`.

## 5. Что нужно подтвердить

См. раздел «Решения владельца» в [плане](../plans/backend-hardening.md): удаление животного, часовой пояс фермы, поведение при достижении лимита сигналов, судьба модуля камеры.
