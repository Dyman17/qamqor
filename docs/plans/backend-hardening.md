Status: implemented (сервер, фазы 0-11; изменения приложения app/ ещё не сделаны)

# План: усиление безопасности и приведение сервера к требованиям (`server/`)

Связанные документы: [../architecture/api-contract.md](../architecture/api-contract.md), [../requirements.md](../requirements.md), [PLAN.md](PLAN.md), [../research/chatgpt-concept-diff.md](../research/chatgpt-concept-diff.md).

Источник: аудит `server/` (передан координатором) и повторная проверка по коду 2026-11-08. Исходный код не менялся.

## 1. Факты, допущения, рекомендации

### 1.1 Проверено по коду

| Код | Подтверждение |
|---|---|
| B1 | `telemetry.controller.ts`: `POST /device/trigger`, `POST /device/buzzer`, `GET /device/buzzer[/:id]`, `GET /device/status[/:id]` без `JwtAuthGuard`. `deviceId` по умолчанию `QAM-0001`. Переопределение хранится в `static Map` в `TelemetryService` и действует 60 минут; `telemetry.service` на любой пинг подставляет его вместо расчёта по границе (зона RED/шок или GREEN). |
| B2 | `telemetry.service.ts` и `camera.service.ts`: запасное значение `'qamqor_esp32_device_shared_key_2026'` для `DEVICE_MASTER_SECRET`; `token === masterSecret` принимается для любого устройства; неизвестное устройство создаётся автоматически (`device.create` в `processDeviceTelemetry`); сравнение через `===`. Тот же секрет записан в `.env.example` и в `mock.service.ts`. |
| B3 | `jwt.strategy.ts` и `auth.module.ts`: запасной секрет `'qamqor_jwt_dev_super_secret_change_in_production_2026'`. |
| B4 | `schema.prisma`: `UserRole { SUPER_ADMIN, FARM_OWNER, FARM_MANAGER, VIEWER }`; роль есть и у `User`, и у `FarmMember`. Проверка роли только в `FarmsService.updateFarm`; остальные сервисы проверяют лишь членство (`verifyFarmAccess`, 6 копий). Нет приглашений, переключателя «Работник может менять границы», лимитов сигналов. `JwtStrategy` берёт `farmId` из `farmMembers[0]` без порядка. |
| B5 | `animals.service`: `device.update({where:{deviceId}, data:{animalId, farmId}})` без проверки, чья это метка: можно присвоить чужой ошейник своей ферме; `activeGeofenceId` и `animalId` в `devices.service.updateDevice` не проверяются на принадлежность ферме. `camera.controller`: `requestPhoto` и `listSnapshots` берут `x-farm-id` без проверки членства. Регистрация ошейника занимает глобально уникальный `deviceId` (захват чужого идентификатора). |
| B6 | `geofence.service.ts`: `isPointInPolygon` возвращает `true` при пустом или короткой кольце; `evaluateLocation` без полигона даёт GREEN, `distanceToPolygonEdgeMeters` -> `Infinity` -> 9999. Животное без загона вообще не попадает в оценку (ветка `device.animal.activeGeofence`). |
| M1 | `battery` в `schema.prisma` (`Device`, `Telemetry`, enum `LOW_BATTERY` в `DeviceStatus` и `AlertType`), `device-telemetry.dto.ts` (обязателен), `alerts.service`, `analytics.service`, `animals.service`, `mock.*`, `seed.ts`, `contracts/index.ts`, `shared/index.ts`; в приложении `Collar.battery`. |
| M2 | Планировщика нет; `Device.status` ставится только при пинге; окно «онлайн» 15 с в `getDeviceLiveStatus` при штатном пинге 300 с (в коде: `DEFAULT_TELEMETRY_INTERVAL_SECONDS` = 300, `EMERGENCY_TELEMETRY_INTERVAL_SECONDS` = 60; в `.env.example` другие имена и значения). `DEVICE_OFFLINE` объявлен, но нигде не создаётся. |
| M3 | `app.module.ts` подключает `MockModule` всегда; `mock.service` создаёт ошейники со общим секретом и вызывает `setManualOverride` на реальных устройствах. |
| M4 | `DEFAULT_SHOCK_SPEC` не используется; каждый пинг в RED возвращает `shock: true`, `shockDurationMs: 150`; в тексте «400кВ», в контракте `voltageEstimateV: 7000` — числа не подтверждены. |
| M5 | см. [api-contract.md](../architecture/api-contract.md), раздел 0. |
| M6 | `auth.service.register` создаёт пользователя, ферму и членство тремя отдельными вызовами без транзакции; пароль `MinLength(6)` без максимума (bcrypt обрезает после 72 байт); ограничения частоты нет; сброса пароля и приглашений нет. |
| M7 | `devices.service` возвращает строку `Device` целиком (включая `secretKey`) из `listDevices`, `getDeviceById`, `registerDevice`, `updateDevice`; `secretKey` хранится открытым текстом, `animals.list` отдаёт выборку без секрета. |
| M8 | `new Date(dto.timestamp)` без проверки: `NaN` проходит проверку окна (`NaN > x` ложно) и ломается на `telemetry.create` (ошибка 500). Окно 7 суток. `animal.update(lastSeenAt…)` только внутри ветки «есть загон». `findFirst` + `create` для дедупликации оповещения без уникального ограничения (гонка). `getAnimalTrack`: `parseInt(limit)` без верхней границы и без проверки `NaN`. |
| M9 | `camera.service`: размер и тип файла не проверяются (multipart без лимита), имя всегда `.jpg`, SVG-заглушка записывается как `.jpg`; `GET /camera/snapshots/image/:fileName` без авторизации (`res.sendFile`); `server/uploads/snapshots/QAM-0002_…jpg` отслеживается git; `uploads/` не в `.gitignore`. |
| Minor | `main.ts`: `origin: true`, `credentials: true`; `tagNumber @unique` глобально; в `Alert` индекс только `[farmId, status]`; нет `Animal(farmId)`, `Device(farmId)`, `Geofence(farmId)`; миграций нет (`prisma db push`); `test/` содержит только `geofence.spec.ts`; `.env.example` содержит значения, похожие на настоящие секреты; в `seed.ts` зашит пароль входа; в `app.controller.ts` URL панели `qamqor-web.onrender.com` не проверен; README описывает несуществующие маршруты (`POST /farms/:id/members`, `PUT /geofences/:id`, `PUT /alerts/:id/resolve`, `steer`). |

Не проверено: `jest.config.js` не содержит `moduleNameMapper` для `@qamqor/shared` и `@qamqor/contracts`, при этом `geofence.spec.ts` импортирует `@qamqor/shared`. Запускается ли существующий тест, не проверялось (тесты не запускались) — первая задача фазы 0.

### 1.2 Допущения (подтвердить)

- Боевой базы с данными нет (PLAN.md, этап 5: подключение Neon не сделано). Если это не так, миграции фаз 3–6 выполнять только после резервной копии и на копии базы.
- Прошивки нет (`esp/` содержит только README), поэтому формат ответа телеметрии можно менять.
- Приложение и сервер развиваются в одной ветке, обратная совместимость со старым клиентом не требуется.
- Один пользователь может быть владельцем нескольких ферм и работником в других.

### 1.3 Значения по умолчанию, выбранные основной сессией (владелец может изменить)

1. Импульс (шок) на сервере **выключен** и **никогда не возвращается** в API до утверждения железа и ветеринарного заключения (в концепции владельца этап 3 не утверждён). Числовые характеристики импульса («400кВ», 7000 В, 0,1 Дж и т. п.) удаляются отовсюду.
2. `MockModule` подключается только при `NODE_ENV !== 'production'` и работает только с ошейниками `isSimulated = true`; на реальные ошейники не пишет.
3. Письма отправляются через интерфейс `Mailer`; по умолчанию транспорт `ConsoleMailer` (пишет в лог в dev, в production отказывается стартовать без настоящего транспорта). Провайдер почты — решение владельца.
4. Новые зависимости только с одобрения владельца; для каждой указана альтернатива без неё.

## 2. Правила выполнения

- Каждая фаза — один запуск `backend-engineer`, затем `code-reviewer`; фазы идут строго по порядку, в одной ветке `feat/backend-hardening`, коммит на фазу.
- **База данных.** Никаких запросов к Neon и любой базе, в которой могут быть реальные данные. Тесты идут только на одноразовой локальной Postgres; `test/setup/assert-test-db.ts` (фаза 0) завершает процесс, если `DATABASE_URL_TEST` указывает не на `localhost`/`127.0.0.1`/`[::1]` или имя базы не оканчивается на `_test`. Агенты не запускают `migrate deploy`/`db push` против `DATABASE_URL` из `.env`; `.env` не читается и не выводится.
- Секреты не печатаются и не коммитятся; тестовые значения генерируются в тестах.
- После каждой фазы: `npm run build`, `npm test`, `npm run test:e2e` (фаза 0 добавляет), результаты в отчёт; не запущенное помечается «не запускалось».

## 3. Предлагаемые зависимости (решает владелец, мы ничего не устанавливаем)

| Пакет | Для чего | Альтернатива без пакета (по умолчанию в плане) |
|---|---|---|
| `supertest`, `@types/supertest`, `@nestjs/testing` (dev) | e2e-тесты HTTP | без них e2e только через `fetch` на поднятом `app.listen(0)` (Node 18+); медленнее и менее удобно. **Рекомендую одобрить.** |
| `@nestjs/throttler` | лимит запросов на вход, регистрацию, сброс | собственный `RateLimitGuard` с `Map` в памяти (подходит для одного экземпляра сервера) |
| `helmet` | заголовки безопасности | ручной middleware с 5–6 заголовками (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security` в production) |
| `@nestjs/schedule` | периодические задачи (офлайн) | `setInterval` в `OnModuleInit` с очисткой в `OnModuleDestroy` и advisory lock Postgres (`pg_try_advisory_lock`) от дублей |
| `nodemailer` (или SDK провайдера) | реальная отправка писем | `ConsoleMailer` (только dev) — в production письма не уйдут |
| `file-type` (опционально) | проверка типа загрузки | проверка сигнатуры (`FF D8 FF` для JPEG, `89 50 4E 47` для PNG) вручную |

## 4. Фазы

Порядок: блокирующие уязвимости первыми. Условные обозначения: файлы указаны относительно `server/`.

### Фаза 0. Основа для проверки и база миграций

Цель: можно безопасно проверять остальные фазы. Закрывает: «нет миграций», «только один тест».

Шаги и файлы:
1. `jest.config.js`: `moduleNameMapper` для `@qamqor/shared`, `@qamqor/contracts`; убедиться, что `test/geofence.spec.ts` проходит (если падает — исправить конфиг, не тест).
2. `test/jest-e2e.config.js`, `test/setup/assert-test-db.ts`, `test/setup/test-app.ts` (создаёт приложение на тестовой базе, очищает таблицы между тестами), `package.json`: скрипты `test:e2e`, `db:test:reset` (только против `DATABASE_URL_TEST`; зависимости на одобрении, см. п. 3).
3. `prisma/migrations/0001_baseline/migration.sql` из текущей схемы командой `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` (не требует базы); `prisma/migrations/migration_lock.toml`. Скрипт `prisma:migrate:deploy`. Для владельца в README: если Neon уже содержит схему от `db push`, один раз выполнить `prisma migrate resolve --applied 0001_baseline` самому. Агент этого не делает.
4. `.gitignore`: `server/uploads/`; `git rm --cached` для `server/uploads/snapshots/QAM-0002_1793647587278_16aee77e.jpg` (файл остаётся на диске).
5. `.env.example`: заменить значения секретов на пустые/`CHANGE_ME`, привести имена переменных к используемым в коде (см. фазу 1).

Приёмка:
- `npm test` проходит, включая 11 тестов `geofence.spec.ts` (названия не меняются).
- `test/migration-baseline.e2e-spec.ts` (на одноразовой базе): `migrate deploy` применяется на пустую базу, затем `prisma migrate diff --exit-code` между миграциями и `schema.prisma` пуст.
- `test/safety-guard.spec.ts`: `assert-test-db` отвергает URL с хостом не localhost и имя базы без `_test`.
- `git ls-files server/uploads` пуст.

### Фаза 1. Секреты и конфигурация (B3, часть B2, CORS, заголовки, M3: подключение)

Файлы: новый `src/config/env.validation.ts`, `src/config/config.ts`; `src/app.module.ts`; `src/auth/auth.module.ts`; `src/auth/jwt.strategy.ts`; `src/main.ts`; `src/telemetry/telemetry.service.ts` и `src/camera/camera.service.ts` (только удаление запасных значений секрета, чтение через типизированный конфиг); `.env.example`; `prisma/seed.ts`; `README.md` (раздел переменных).

Шаги:
1. Проверка окружения при старте (без новых пакетов, вручную): обязательны `DATABASE_URL`, `JWT_SECRET` (≥ 32 символов, не из списка известных запасных/примерных значений), `CORS_ORIGINS` в production. Отсутствие даёт отказ запуска с понятной ошибкой. `DEVICE_MASTER_SECRET` удаляется из кода (замена в фазе 2).
2. Имена переменных единые: `NORMAL_PING_INTERVAL_SEC`, `EMERGENCY_PING_INTERVAL_SEC` (как в `.env.example`); код читает их, значения по умолчанию 300 и 60 (текущее поведение; допущение).
3. CORS: список из `CORS_ORIGINS` (через запятую); без `origin: true`; `allowedHeaders` явный (`authorization, content-type, x-farm-id`); приложение React Native не использует CORS, список нужен для будущего сайта.
4. `ValidationPipe`: `forbidNonWhitelisted: true`, `whitelist: true`, `transform: true`, ограничение размера JSON (1 МБ); заголовки безопасности (helmet или ручной middleware); `app.disable('x-powered-by')`.
5. `AppModule`: `MockModule` подключается условно (`NODE_ENV !== 'production'`); `AppController` без поля `dashboard`.
6. `seed.ts`: отказ запуска при `NODE_ENV=production`; пароль берётся из `SEED_OWNER_PASSWORD` или генерируется случайно и печатается один раз в dev.

Приёмка:
- `test/config.spec.ts`: `validateEnv` бросает ошибку при отсутствии `JWT_SECRET`, при длине < 32, при значении из списка известных; принимает корректный набор.
- `test/security-headers.e2e-spec.ts`: ответ содержит `X-Content-Type-Options: nosniff`, нет `X-Powered-By`; запрос с `Origin: https://evil.example` не получает `Access-Control-Allow-Origin`.
- `test/mock-gating.e2e-spec.ts`: при `NODE_ENV=production` `POST /api/v1/mock/inject-telemetry` отвечает 404.
- `grep -rn "qamqor_esp32_device_shared_key\|qamqor_jwt_dev_super_secret" server/src server/prisma` не находит совпадений в коде (допустимо только в тестах как список запрещённых значений).

### Фаза 2. Контур ошейников: аутентификация устройств (B1, B2, M7, M3: симулятор)

Схема (миграция `0002_device_auth`): `Device.secretKey` -> `secretHash String` (SHA-256 от случайных 32 байт, hex); `Device.isSimulated Boolean @default(false)`; `DeviceCommand`: добавить `type` из ограниченного набора, `acknowledgedAt`. Старые значения `secretKey` не переносятся (аннулируются, секреты выдаются заново).

Файлы: новые `src/devices/device-auth.guard.ts`, `src/devices/device-secret.ts` (генерация, хеш, `timingSafeEqual`); `src/telemetry/telemetry.controller.ts` (удалить `trigger`, `buzzer`, `status` и статический `overrides`); `src/telemetry/telemetry.service.ts`; `src/devices/devices.controller.ts`, `devices.service.ts`, `dto/device.dto.ts`; `src/camera/camera.controller.ts`, `camera.service.ts` (использовать `DeviceAuthGuard`); `src/mock/mock.service.ts`, `mock.controller.ts`; `prisma/schema.prisma`; `prisma/seed.ts`.

Шаги:
1. `DeviceAuthGuard`: заголовок `Bearer`, поиск по `deviceId` из тела/запроса, сравнение хеша через `timingSafeEqual`; на любую ошибку (нет устройства, неверный секрет) один и тот же 401; автосоздания нет.
2. `POST /devices` создаёт ошейник в ферме пользователя и возвращает `deviceSecret` один раз; `POST /devices/:deviceId/rotate-secret` (**superseded: маршрут удалён 2026-11-10, ошейник авторизуется 8-значным кодом, секрет ничего не проверял**); секреты и хеши не попадают ни в один ответ (явные `select`/мапперы `CollarDto`, см. контракт). Регистрация существующего `deviceId` другой фермы даёт 409 без раскрытия, чей он.
3. Удалить `POST /device/trigger`, `POST|GET /device/buzzer[/:id]`, `GET /device/status[/:id]`. Вместо них `POST /devices/:deviceId/test-signal` (JWT, членство, только `SOUND`/`VIBRATION`) -> запись в `DeviceCommand`; следующий пинг получает `command` и помечает выполненной. Переопределения «зона RED принудительно» больше нет.
4. Симулятор: работает только с `isSimulated = true`, создаёт такие ошейники со случайным секретом, не вызывает ничего вроде `setManualOverride`, не пишет реальным устройствам.

Приёмка (e2e):
- `device-auth.e2e-spec.ts`: пинг без токена -> 401; с неверным токеном -> 401; с токеном другого ошейника -> 401; неизвестный `deviceId` -> 401 (тот же текст), устройство не создаётся; с верным -> 200.
- `legacy-device-endpoints.e2e-spec.ts`: `POST /device/trigger`, `POST /device/buzzer`, `GET /device/status` -> 404.
- `device-secret-leak.e2e-spec.ts`: ответы `GET/POST/PATCH /devices*` не содержат `secretKey`/`secretHash`; `deviceSecret` есть только в ответах создания и ротации.
- `test-signal.e2e-spec.ts`: без JWT 401; чужая ферма 403/404; `signal: 'IMPULSE'` -> 400; `SOUND` попадает в ответ следующего пинга один раз.
- `mock-isolation.e2e-spec.ts`: инъекция на реальный (`isSimulated=false`) ошейник -> 4xx, запись в телеметрию не создаётся.
- Unit: `device-secret.spec.ts` (хеш детерминирован, сравнение постоянного времени используется).

### Фаза 3. Изоляция ферм (B5, tagNumber)

Схема (`0003_tenancy`): `Animal.tagNumber` из глобального `@unique` в `@@unique([farmId, tagNumber])`; индексы `Animal(farmId)`, `Device(farmId)`, `Geofence(farmId)`.

Файлы: новый `src/farms/farm-access.guard.ts` и `farm-context.decorator.ts` (читает `x-farm-id`, проверяет членство, кладёт `farmId` и `memberRole` в запрос; единственная ферма пользователя подставляется, если заголовок не указан и ферма одна, иначе 400); все контроллеры `animals`, `devices`, `geofences`, `alerts`, `analytics`, `camera`, `mock` переходят на guard; удалить 6 копий `verifyFarmAccess` и `resolveFarmId`; `src/auth/jwt.strategy.ts` (убрать `farmId: farmMembers[0]`); сервисы `animals`, `devices`, `geofences`.

Шаги: любой входящий `animalId`, `deviceId`, `activeGeofenceId`, `animalIds`, `penId` проверяется на принадлежность ферме запроса в одном месте (`assertSameFarm` в общем помощнике); привязка ошейника: `where: {deviceId, farmId}` и 404 для чужого; `createAnimal` не принимает `farmId` в теле; `requestPhoto`/`listSnapshots` под guard.

Приёмка (e2e `tenancy.e2e-spec.ts`, две фермы A и B с пользователями):
- пользователь A с `x-farm-id` фермы B на каждый маршрут (`animals`, `devices`, `geofences`, `alerts`, `analytics`, `camera/snapshots`, `camera/request-photo`) -> 403;
- привязка ошейника фермы B к животному фермы A -> 404; `activeGeofenceId` чужой фермы при создании и изменении животного -> 400/404; `animalIds` чужие в геозоне игнорируются или отклоняются (зафиксировать выбранное поведение в тесте);
- одинаковый `tag` в разных фермах допускается, в одной -> 409;
- `ownerless` запрос без заголовка при двух фермах -> 400.

### Фаза 4. Роли, права, настройки фермы (B4)

Схема (`0004_roles`): новый enum `FarmRole { OWNER WORKER }`; `FarmMember.role FarmRole`; `User.role` и `UserRole` удаляются (SUPER_ADMIN, VIEWER, FARM_MANAGER не нужны по требованиям); `Farm`: `workerCanEditBoundaries Boolean @default(false)`, `timezone String @default("Asia/Almaty")`; таблица `SignalLimit { farmId, level SOUND|VIBRATION|IMPULSE, dailyLimit Int?, unlimited Boolean @default(false) }` с `@@unique([farmId, level])`. Миграция данных: `FARM_OWNER` -> `OWNER`, остальные -> `WORKER` (в тестовой проверке).

Файлы: `src/farms/roles.decorator.ts` (`@FarmRoles('OWNER')`), `src/farms/permissions.guard.ts` (политика B: владелец или работник при включённом переключателе), `farms.controller/service`, `dto/farm.dto.ts`, новые `farms/signal-limits.*`; аннотации прав в остальных контроллерах по таблице контракта; `src/shared/index.ts` и `src/contracts/index.ts` (убрать старый `UserRole`, добавить `FarmRole`); `AuthService.register` (членство OWNER).

Правила (из `requirements.md`, строка «Роли»): работник — карта, стадо, оповещения, правка животных, привязка/отвязка ошейников; без лимитов сигналов и настроек фермы; рисует/перегоняет только при переключателе (по умолчанию выключен); удаляет загоны и создаёт фермы только владелец.

Приёмка (e2e `roles.e2e-spec.ts`, матрица владелец/работник x маршрут):
- работник: `PUT /farms/:id/signal-limits` -> 403, `PATCH /farms/:id` -> 403, `DELETE /geofences/:id` -> 403, `POST /farms` -> 403, `DELETE /devices/:id` -> 403, `POST/PATCH /geofences` и `POST /animals/steer` -> 403 при `workerCanEditBoundaries=false` и 200 при `true`; `PATCH /animals/:id`, `assign-collar`, `unassign-collar` -> 200;
- переключатель по умолчанию `false` на новой ферме; менять его может только владелец;
- владельца нельзя убрать из фермы; работник не видит список участников и приглашений.

### Фаза 5. Вход, приглашения, сброс пароля, регистрация (M6)

Схема (`0005_auth`): `Invitation { id, farmId, email, tokenHash, invitedById, expiresAt, acceptedAt?, revokedAt? }`; `PasswordResetToken { id, userId, tokenHash, expiresAt, usedAt? }`; `User.passwordChangedAt DateTime?` (токены, выданные раньше, недействительны).

Файлы: `src/mail/mailer.interface.ts`, `console-mailer.ts`, `mail.module.ts`; `src/auth/auth.service.ts`, `auth.controller.ts`, `dto/auth.dto.ts`, `jwt.strategy.ts`; `src/farms/invitations.*`; `src/common/rate-limit.guard.ts`; шаблоны писем kk/ru/en (тексты kk — на проверку носителю языка).

Шаги: регистрация в одной `$transaction` (пользователь, ферма, членство OWNER); пароль 10–72 символа (допущение, подтвердить длину), сравнение bcrypt (стоимость 12); одинаковые ответы и время для неизвестного email при сбросе; токены 32 байта, в базе только SHA-256, одноразовые, срок приглашения 7 суток и сброса 1 час (допущения); принятие приглашения привязано к email приглашения; лимит запросов на `login`, `register`, `password-reset/*`, `invitations/accept` (например 10 в минуту на IP+email, допущение).

Приёмка (e2e `auth.e2e-spec.ts`):
- сбой создания фермы откатывает пользователя (внедрить ошибку в тесте) — пользователь не остаётся;
- пароль 5 символов и 73 символа -> 400; одиннадцатая попытка входа за минуту -> 429;
- сброс: `request` на несуществующий email -> 204 и письмо не отправлено; токен работает один раз; после сброса старый JWT -> 401;
- приглашение: владелец приглашает -> `ConsoleMailer` (подставлен тестовый) получил письмо; принять можно только с email приглашения; просроченное/отозванное -> 400; работник не может приглашать (403); принявший получает роль `WORKER`, а `POST /farms` ему недоступен.

### Фаза 6. Удаление батареи (M1)

Решение владельца: датчика заряда нет. Схема (`0006_drop_battery`): удалить `Device.battery`, `Telemetry.battery`, значения `LOW_BATTERY` из `DeviceStatus` и `AlertType` (после перевода существующих `LOW_BATTERY` в `ONLINE`/удаления соответствующих оповещений в SQL миграции).

Файлы: `prisma/schema.prisma`, `prisma/seed.ts`, `telemetry/dto/device-telemetry.dto.ts`, `telemetry.service.ts`, `alerts.service.ts` (удалить `checkLowBattery`, `lowBatteries`), `alerts.controller.ts`, `analytics.service.ts` (убрать `lowBatteryDevices`), `animals.service.ts` (выборки), `mock/*`, `src/contracts/index.ts`, `src/shared/index.ts`, `README.md`; приложение: `app/src/types/index.ts` `Collar.battery` и использования — отдельная задача для frontend-engineer (в этот план не входит, указана в контракте).

Приёмка:
- `grep -rni "battery" server/src server/prisma server/test` пусто (кроме миграции, где значение удаляется);
- `battery-removed.e2e-spec.ts`: пинг без `battery` -> 200; пинг с лишним `battery` -> 400 (из-за `forbidNonWhitelisted`); `/alerts/stats` и `/analytics/overview` без полей `lowBatteries`/`lowBatteryDevices`;
- миграция применяется на базе, где есть строки с `LOW_BATTERY` (фикстура в тесте).

### Фаза 7. Телеметрия и геометрия: надёжность и «импульс выключен» (B6, M4, M8)

Файлы: `src/geofences/geofence.service.ts`, `dto/geofence.dto.ts` (валидатор полигона), `src/telemetry/telemetry.service.ts`, `dto/device-telemetry.dto.ts`, `src/contracts/index.ts` (удалить `ShockSpec`, `DEFAULT_SHOCK_SPEC`, `voltageEstimateV`, `shock*`), `src/alerts/alerts.service.ts`, `src/animals/animals.controller.ts` (`limit`), схема (`0007_alert_dedupe`: частичный уникальный индекс на активное оповещение `(animalId, type) WHERE status='ACTIVE'` через SQL в миграции; `Telemetry(animalId, timestamp)` уже есть).

Шаги:
1. Геометрия fail-closed: `evaluateLocation` возвращает `UNKNOWN` (inFence=null, все исполнительные выключены, `GPS_LOST`/«граница не задана» в событии) при пустом/некорректном полигоне, при `accuracy > 35`, при НЕ задан загон у животного. Ни одно из этих состояний не включает звук/вибрацию и не даёт GREEN как «безопасно» (в ответе явный `UNKNOWN`). Валидатор полигона при создании: замкнутое кольцо, ≥ 3 различных вершины, диапазоны, без самопересечений, площадь > 0.
2. `timestamp`: валидный ISO (`@IsISO8601`), не старше 10 минут, не позже +2 минут (допущения; параметры в конфиге); иначе 400. Положение животного и `lastSeenAt`/`Device.lastHeartbeatAt` обновляются на каждый валидный пинг независимо от наличия загона. `signal` в диапазоне [-130, 0] (допущение).
3. Оповещения: уникальный индекс + `create` с перехватом `P2002` (идемпотентно).
4. Импульс: из ответа телеметрии и из контрактов удалены `shock`, `shockDurationMs`, текст «400кВ», эмодзи; зона RED = звук + вибрация. Конфиг `IMPULSE_ENABLED` не вводится, пока владелец не примет решение (код запрета один, без обходов).
5. `track`: `limit` целое 1–500 (по умолчанию 100), `from`/`to` необязательны, иначе 400.

Приёмка:
- `geofence.spec.ts` (расширение): пустой полигон, кольцо из 2 точек, `null`, `{}` -> зона `UNKNOWN`, не GREEN; невалидные полигоны отвергаются валидатором (самопересечение, незамкнутое, координаты вне диапазона);
- `telemetry.e2e-spec.ts`: `timestamp: "abc"` -> 400 (не 500); старше 10 минут -> 400; из будущего -> 400; животное без загона: пинг обновляет `lastSeenAt` и положение; в ответе нет полей `shock*` ни для каких зон (RED, ESCAPE); `warningMessage` не содержит «кВ»;
- два параллельных пинга RED -> ровно одно активное `GEOFENCE_BREACH`;
- `GET /animals/:id/track?limit=999999` -> 400 или обрезается до 500 (зафиксировать в тесте); `limit=abc` -> 400.

### Фаза 8. Связь, офлайн-оповещения, счётчики и лимиты сигналов (M2)

Схема (`0008_offline_signals`): `Device.lastSeenAt` (если `lastHeartbeatAt` будет переименовано — одно имя); `SignalEvent { id, farmId, animalId, deviceId, level SOUND|VIBRATION|IMPULSE, at }` с индексом `(farmId, animalId, at)`; значения `SIGNAL_LIMIT_REACHED` в `AlertType`; `DeviceStatus` остаётся `ONLINE|OFFLINE|NO_GPS|INACTIVE`.

Файлы: `src/devices/connectivity.service.ts` (вычисляет статус из `lastSeenAt` и интервала: офлайн после `OFFLINE_AFTER_MISSED_PINGS` x `NORMAL_PING_INTERVAL_SEC`, по умолчанию 3 x 300 = 900 с — допущение, пороги — вопрос владельца №5 из спеки), `src/devices/offline-watcher.service.ts` (`setInterval` или `@nestjs/schedule`, одиночный запуск через advisory lock), `src/alerts/alerts.service.ts`, `src/telemetry/telemetry.service.ts` (запись `SignalEvent`, проверка лимитов), `src/animals/animals.controller.ts` (`GET /animals/:id/signals`), `farms/signal-limits.*` (из фазы 4).

Шаги: `DEVICE_OFFLINE` создаётся, когда ошейник с животным не выходил на связь дольше порога, и закрывается `DEVICE_RESTORED` при пинге; `status` в API вычисляется на чтении, а не хранится «залипшим»; удалить окно 15 с; при достижении суточного лимита уровня (границы суток в часовом поясе фермы) сервер не подаёт этот сигнал, ставит `suppressedBy: 'SIGNAL_LIMIT'` и создаёт `SIGNAL_LIMIT_REACHED` (поведение — решение владельца, см. раздел 5; по умолчанию как описано); пустой лимит = «не задан» (подавления нет), `unlimited = true` = без подавления.

Приёмка:
- `connectivity.spec.ts` (unit, фиктивные часы): пинг 299 с назад -> ONLINE, 901 с -> OFFLINE; ошейник без животного -> UNASSIGNED;
- `offline-watcher.e2e-spec.ts`: ошейник, не выходивший на связь, получает одно активное `DEVICE_OFFLINE` (повторный запуск не плодит); пинг закрывает его и создаёт `DEVICE_RESTORED`; запуск двух экземпляров наблюдателя создаёт одно оповещение;
- `signal-limits.e2e-spec.ts`: при лимите 2 третий звук в сутки подавлен, создано одно `SIGNAL_LIMIT_REACHED`; смена суток по часовому поясу фермы сбрасывает счётчик; `unlimited` отключает подавление; `GET /animals/:id/signals` отдаёт `impulse.available=false`.

### Фаза 9. Согласование с приложением (M5)

Файлы сервера: новые мапперы `src/*/mappers/*.ts` (`AnimalDto`, `CollarDto`, `PenDto`, `AlertDto` из контракта), `animals.controller/service` (`assign-collar`, `unassign-collar`, `steer`), `geofences` (`areaHa`, `animalsCount`), `alerts` (`isRead`, `penName`), `contracts/index.ts` (синхронизация с документом). Файлы приложения (`app/src/services/api.ts`, `types/index.ts`, экраны) не входят в этот план; отдельная задача для frontend-engineer по таблице соответствия в [api-contract.md](../architecture/api-contract.md): заголовок `x-farm-id`, удалить `battery`, убрать `triggerActuator(…, {shock})` и зашитый `QAM-0001`, переключатель «Работник может менять границы» по умолчанию выключен.

Приёмка:
- `contract.e2e-spec.ts`: для каждого маршрута из раздела 3 контракта проверяются форма ответа (ключи и типы) и права; снимок ключей хранится в тесте; ответы не содержат `secretKey`, `battery`, `shock*`;
- `steer.e2e-spec.ts`: групповой перегон меняет `penId` выбранных животных, животное другой фермы -> 404, офлайн-животные перечислены в `skippedOffline`;
- ручная сверка таблицы «Соответствие `app/src/types`» с `app/src/types/index.ts` (frontend-engineer подтверждает после правок приложения; до этого — «не выполнено»).

### Фаза 10. Загрузки и камера (M9)

Шаг 0: владелец решает судьбу модуля камеры (раздел 5). Если модуль удаляется: убрать `src/camera/`, `CameraSnapshot`, `DeviceCommand` с типом `CAPTURE_PHOTO` (миграция `0010_drop_camera`), упрощается mock.

Если остаётся: файлы `src/camera/camera.controller.ts`, `camera.service.ts`, `dto/camera.dto.ts`, `src/main.ts` (лимиты), `.gitignore`.

Шаги: `FileInterceptor` с `limits.fileSize` 1 МБ (допущение, подбирается под камеру); тип по сигнатуре (JPEG/PNG), расширение и `Content-Type` из определённого типа; SVG-заглушка удаляется (без файла — 400); имя файла = случайный UUID, каталог вне веб-корня, путь строится из id записи; отдача `GET /camera/snapshots/:id/image` только с JWT и проверкой фермы, `nosniff`, `Content-Disposition: inline`; публичный маршрут по имени файла удаляется; base64: лимит длины и проверка; `photoUrl` животного не подставляется автоматически из чужого источника без проверки.

Приёмка (`camera.e2e-spec.ts`): файл 2 МБ -> 413; SVG/HTML под видом `.jpg` -> 400; JPEG принят и отдаётся с `image/jpeg`; запрос изображения без JWT -> 401, из другой фермы -> 404/403; старый путь `/camera/snapshots/image/<имя>` -> 404; `git ls-files server/uploads` пуст.

### Фаза 11. Остаток и документация

Файлы: `schema.prisma` (недостающие индексы, например `Alert(farmId, createdAt)`, `Alert(animalId, type, status)`, `Telemetry` — по результатам `EXPLAIN` на тестовой базе), DTO без `string`-только полей (`@MaxLength`, `@IsUUID`, `@Matches` для `deviceId`), `README.md` (переписать: реальные маршруты, переменные окружения, запуск миграций и тестов, предупреждение про базу), `docs/plans/PLAN.md` (отметить сделанное; запись делает основная сессия), удалить устаревшие README-маршруты.

Приёмка: `dto-validation.e2e-spec.ts` (слишком длинные строки, невалидный UUID, лишние поля -> 400); `README.md` не содержит маршрутов, которых нет в `contract.e2e-spec.ts`; `npm run build` и все тесты проходят.

## 5. Решения владельца

Приняты владельцем 2026-11-08 (значения по умолчанию из плана подтверждены, отклонения помечены). Реализованы в фазах 4-11.

| № | Вопрос | Решение 2026-11-08 |
|---|---|---|
| 1 | Новые пакеты | **Никаких новых зависимостей.** Планировщик офлайна: `setInterval` в `onModuleInit` (отключён в тестах), без `@nestjs/schedule`. Ограничение частоты входа и регистрации: собственный лимитер в памяти (один экземпляр). Почта: интерфейс `Mailer` и `ConsoleMailer`. Без `supertest`: HTTP-тесты на `NestFactory` и `fetch` с поддельной базой |
| 2 | Почтовый провайдер | Не выбран. `ConsoleMailer`; в production он логирует только адресата и тему (токены не пишутся) и предупреждает, что письмо не доставлено. Отклонение от плана: production **не отказывается стартовать** без почты (иначе развёрнутый на Render сервер не поднялся бы); приглашения и сброс пароля в production работают только после выбора провайдера |
| 3 | Достигнут суточный лимит сигнала | Сервер подавляет этот сигнал (`suppressedBy: SIGNAL_LIMIT`) и создаёт оповещение `SIGNAL_LIMIT_REACHED` (одно на животное, уровень и сутки). Лимит: `null` = не задан (без подавления), целое >= 1; `0` отклоняется; `unlimited = true` = без подавления |
| 4 | Модуль камеры | **Отключён** (не подключён в `AppModule`) до появления железа; код оставлен и усилен (фаза 10), симулятор фото удалён |
| 5 | Порог «нет связи» | 3 пропущенных пинга: 3 x `NORMAL_PING_INTERVAL_SEC` (900 с при 300 с), настраивается `OFFLINE_AFTER_MISSED_PINGS`. Ошейник, ни разу не выходивший на связь, оповещение `DEVICE_OFFLINE` не получает (в списке он «офлайн») |
| 6 | Часовой пояс суток | Границы суток по `Farm.timezone`, по умолчанию **Asia/Aqtau (UTC+5)** (вместо Asia/Almaty из плана) |
| 7 | Удаление животного | Работник тоже может (право W); отдельного журнала удалений пока нет |
| 8 | Виды животных | Перечисление CATTLE, HORSE, CAMEL, SHEEP, GOAT оставлено как есть |
| 9 | Пароль | **8-72** символа (и не более 72 байт, так как bcrypt обрезает по байтам). Вместо 10-72 из плана |
| 10 | Миграции | Базовая миграция + шаги. Все новые миграции написаны для базы с данными. Замечание: имя каталога `0_init` в лексикографическом порядке стоит **после** `0002_...`/`0003_...`; на пустой базе `migrate deploy` применит их в этом порядке. Переименование не делалось, так как база Neon уже могла записать имена; решение за владельцем |
| 11 | Импульс | Остаётся выключенным: не возвращается и не принимается, числовые характеристики удалены отовсюду |
| 12 | Периодичность связи | Оставлено 300 с штатно / 60 с при выходе за границу |
| - | Роли | `FarmRole` OWNER / WORKER (`requirements.md`, строка «Роли»); `Farm.workerCanEditBoundaries` (имя из контракта) по умолчанию `false`; приглашения по email (токен, срок 7 суток), токены сброса пароля (1 час) |
| - | Батарея | Удалена везде: схема, DTO, оповещения, аналитика, контракты, shared, seed |

## 6. Не входит в план

- Правки `app/`, `esp/`, `site/` (кроме списка изменений приложения в контракте).
- Выбор канала связи в поле (LoRa/сотовая), прошивка, пуш-уведомления (A8), версии границ и отмена перегона (A3), подтверждение команд ошейником (A4).
- Запуск миграций на Neon и любая работа с боевой базой.

## 7. Риски

- Миграции 0004 и 0006 меняют enum'ы PostgreSQL; на непустой базе требуют перевода данных в SQL (проверяется на одноразовой базе с фикстурами).
- Фазы последовательны; фаза 2 правит те же файлы, что 6 и 7, поэтому параллельных писателей быть не должно.
- Без `supertest` e2e-тесты будут тяжелее; если пакет не одобрен, фазу 0 расширить помощником над `fetch`.
