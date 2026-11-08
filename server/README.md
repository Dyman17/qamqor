# Qamqor Server (REST API и приём телеметрии ошейников)

Бэкенд приложения Qamqor: виртуальные заборы для скота, ошейники, оповещения, роли и приглашения.
Полный контракт (типы, права, коды ошибок): [../docs/architecture/api-contract.md](../docs/architecture/api-contract.md).
План усиления: [../docs/plans/backend-hardening.md](../docs/plans/backend-hardening.md).

## Стек

NestJS 11 (TypeScript), Prisma 6, PostgreSQL, JWT (Passport), bcrypt (стоимость 12). Новых зависимостей для планировщика, лимитов запросов и почты нет: фоновая проверка на `setInterval`, лимитер в памяти, интерфейс `Mailer` с консольным транспортом.

## Маршруты

Все маршруты, кроме `GET /api/info` и `GET /health`, находятся под префиксом `/api/v1`. Права: **O** владелец, **W** владелец и работник, **B** владелец или работник при включённом `workerCanEditBoundaries`, **Д** ошейник (`Authorization: Bearer <deviceSecret>`).
Данные фермы читаются с заголовком `x-farm-id` (если ферма одна, заголовок можно опустить).

Служебные (без авторизации):

- `GET /api/info` — статус сервиса и версия (корень `/` отдаёт сайт `site/dist`, если он собран)
- `GET /health` — проверка работоспособности

Аутентификация:

- `POST /api/v1/auth/register` — регистрация (пользователь, ферма, членство OWNER в одной транзакции)
- `POST /api/v1/auth/login` — вход
- `GET /api/v1/auth/me` — профиль и членства
- `POST /api/v1/auth/password-reset/request` — запрос сброса пароля (всегда 204)
- `POST /api/v1/auth/password-reset/confirm` — новый пароль по одноразовому токену
- `POST /api/v1/auth/invitations/accept` — принять приглашение в ферму (роль WORKER)

Фермы (адресуются по `:id`):

- `GET /api/v1/farms`, `POST /api/v1/farms` (O), `GET /api/v1/farms/:id`, `PATCH /api/v1/farms/:id` (O)
- `GET /api/v1/farms/:id/members` (O)
- `DELETE /api/v1/farms/:id/members/:userId` (O)
- `POST /api/v1/farms/:id/invitations` (O)
- `DELETE /api/v1/farms/:id/invitations/:invId` (O)
- `GET /api/v1/farms/:id/signal-limits` (O)
- `PUT /api/v1/farms/:id/signal-limits` (O)

Стадо (W):

- `GET /api/v1/animals`, `POST /api/v1/animals`, `GET /api/v1/animals/:id`, `PATCH /api/v1/animals/:id`, `DELETE /api/v1/animals/:id`
- `GET /api/v1/animals/:id/track`, `GET /api/v1/animals/:id/events`, `GET /api/v1/animals/:id/signals`
- `POST /api/v1/animals/:id/assign-collar`, `POST /api/v1/animals/:id/unassign-collar`
- `POST /api/v1/animals/steer` (B) — групповой перегон

Загоны:

- `GET /api/v1/geofences`, `GET /api/v1/geofences/:id` (W)
- `POST /api/v1/geofences`, `PATCH /api/v1/geofences/:id` (B)
- `DELETE /api/v1/geofences/:id` (O)

Ошейники:

- `GET /api/v1/devices`, `GET /api/v1/devices/:id`, `POST /api/v1/devices`, `PATCH /api/v1/devices/:id` (W)
- `POST /api/v1/devices/:id/rotate-secret`, `POST /api/v1/devices/:id/test-signal` (W)
- `DELETE /api/v1/devices/:id` (O)
- `POST /api/v1/device/telemetry` (Д) — пинг ошейника по 8-значному коду (`code` в теле или `X-Device-Code`); ответ содержит тот же `code`

Оповещения и аналитика (W):

- `GET /api/v1/alerts`, `GET /api/v1/alerts/stats`, `POST /api/v1/alerts/read-all`, `PATCH /api/v1/alerts/:id/status`
- `GET /api/v1/analytics/overview`

Режимы данных «Реальный / Ручной (пилот) / Авто (симуляция)», все с `:id` фермы (во всех окружениях; выключатель `DEMO_MODES_ENABLED`):

- `GET /api/v1/farms/:id/simulation` (W; отмечает, что ферму смотрят), `PATCH /api/v1/farms/:id/simulation` (O)
- `PUT /api/v1/farms/:id/data-mode` (O), `POST /api/v1/farms/:id/simulation/start`, `POST /api/v1/farms/:id/simulation/stop`, `POST /api/v1/farms/:id/simulation/reset` (O)
- `POST /api/v1/farms/:id/simulate/animals`, `POST /api/v1/farms/:id/simulate/telemetry`, `POST /api/v1/farms/:id/simulate/events` (O, режим MANUAL)

Демо-данные помечены (`isDemo`, `Device.isSimulated`) и удаляются при возврате в `REAL`; реальные ошейники работают в любом режиме. Подробности: `docs/architecture/api-contract.md`.

Камера (`/camera/*`) не подключена до появления железа. Импульс (шок) сервером не используется и в API не возвращается.

## Переменные окружения

Значения не хранятся в репозитории; шаблон: [.env.example](.env.example). Сервер не стартует с небезопасной конфигурацией.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | строка подключения PostgreSQL (обязательна) |
| `JWT_SECRET` | не короче 32 символов, не из списка известных значений (обязательна) |
| `JWT_EXPIRES_IN` | срок жизни JWT, по умолчанию `7d` |
| `CORS_ORIGINS` | список разрешённых источников через запятую (обязательна в production) |
| `NORMAL_PING_INTERVAL_SEC` / `EMERGENCY_PING_INTERVAL_SEC` | интервалы пинга ошейника, 300 / 60 |
| `OFFLINE_AFTER_MISSED_PINGS` | пропущенных пингов до статуса «нет связи», 3 (порог 3 x 300 = 900 с) |
| `OFFLINE_CHECK_INTERVAL_SEC`, `SCHEDULER_ENABLED` | период фоновой проверки (60 с) и её отключение |
| `TELEMETRY_MAX_AGE_SEC` / `TELEMETRY_MAX_FUTURE_SEC` | окно допустимого `timestamp` пинга, 600 / 120 |
| `TRUST_PROXY_HOPS` | сколько прокси-узлов доверять для IP клиента (по умолчанию 1 в production, 0 иначе; значение пишется в лог при старте) |
| `SITE_DIST_DIR` | каталог собранного сайта (по умолчанию `../site/dist` относительно `server/`); если его нет, сайт не раздаётся, API работает. Всё, что не под `/api` и `/health`, отдаёт SPA (fallback на `index.html`). CSP задаётся в `src/config/csp.ts` |
| `APP_BASE_URL` | база ссылок в письмах (необязательна) |
| `DEMO_MODES_ENABLED` | демо-режимы (ручной и авто); по умолчанию `true`; `false` = маршруты симуляции отвечают 404 (кроме чтения состояния), симулятор не стартует |
| `SIM_TICK_SEC` / `SIM_DEMO_OFFLINE_SEC` | период тика симулятора (10 с) и сжатый демо-порог «ошейник молчит» сценария AUTO (90 с; только для демо) |
| `SEED_OWNER_PASSWORD` | только для `prisma:seed` в разработке; пусто = случайный пароль, печатается один раз |

Почтовый провайдер пока не выбран владельцем: письма (приглашения, сброс пароля) пишет `ConsoleMailer`. В production он логирует только адресата и тему, ничего не доставляя.

## Запуск

```bash
cd server
npm install
cp .env.example .env        # заполните DATABASE_URL и JWT_SECRET
npm run prisma:generate
npm run start:dev
```

## База данных и миграции

Схема меняется только миграциями из `prisma/migrations/`. Применение: `npm run prisma:migrate:deploy` (на Render выполняется при старте). Миграции написаны так, чтобы работать на базе с данными (перевод ролей, удаление значений enum после перевода строк, очистка дублей оповещений).

ВАЖНО: не запускайте `migrate`, `db push` и `prisma:seed` против базы, в которой могут быть реальные данные (Neon). Для разработки и проверок используйте отдельную одноразовую локальную базу. Новую миграцию без базы можно получить сравнением схем:
`npx prisma migrate diff --from-schema-datamodel <старая schema.prisma> --to-schema-datamodel prisma/schema.prisma --script`.
Частичный уникальный индекс активных оповещений (`alerts_active_dedupe_key`, миграция 0007) создан SQL и не описывается в `schema.prisma`: при `migrate dev` его нужно сохранить.

## Тесты

```bash
npm test          # jest: модульные тесты и HTTP-тесты с поддельной базой, ни к какой базе не подключаются
npx tsc --noEmit
npm run build
```

## Безопасность в двух словах

Секреты ошейников хранятся только хешем и показываются один раз; ферма проверяется в одном месте (`FarmAccessGuard`), права — `PermissionsGuard`; ошибки имеют вид `{ statusCode, code, message }`; ограничение частоты (в памяти, рассчитано на один экземпляр сервера: при нескольких экземплярах счётчики не общие; вход дополнительно ограничен 20 попытками за 10 минут на email независимо от IP) стоит на входе, регистрации, сбросе пароля и приёме приглашения.
