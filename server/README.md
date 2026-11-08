# 🛰️ Qamqor Server (Backend API & Geofencing Gateway)

Backend-сервер IoT-платформы **Qamqor** для спутникового мониторинга, виртуального ограждения (Virtual Fencing) и управления выпасом сельскохозяйственных животных.

---

## 🏗️ Архитектура

* **Фреймворк:** NestJS 11 (TypeScript)
* **ORM:** Prisma 6
* **База данных:** PostgreSQL / PostGIS
* **Безопасность:** JWT (Passport), Bcrypt, Bearer Secret для ESP32-ошейников
* **Алгоритмы геозонирования:** Ray-Casting Point-in-Polygon, Евклидово/ортодромическое расстояние до границ, 4-зонная градация стимуляции (Green / Yellow / Orange / Red / Escape).

---

## 📡 Эндпоинты API

### 1. IoT Телеметрия ошейников (ESP32)

* `POST /api/v1/device/telemetry` — приём GPS координат, заряда аккумулятора и уровня Wi-Fi. Вычисляет положение относительно границ загона и возвращает команды триггерам ошейника (звук, вибрация, импульс).
* `POST /api/v1/device/trigger` — ручное управление исполнительными механизмами ошейника (тест звука, вибрации, импульса, сброс тревоги).
* `GET /api/v1/device/status` — проверка статуса ошейника в реальном времени (Online, если пинг был в пределах последних 15-45 сек).

### 2. Авторизация и пользователи

* `POST /api/v1/auth/register` — регистрация владельца фермы
* `POST /api/v1/auth/login` — вход по email и паролю
* `GET /api/v1/auth/me` — профиль текущего пользователя и его фермы

### 3. Фермы и пастбища (Geofences)

* `GET /api/v1/farms` — список ферм
* `POST /api/v1/farms/:id/members` — приглашение работника
* `GET /api/v1/geofences` — список загонов (GeoJSON полигоны)
* `POST /api/v1/geofences` — создание нового виртуального загона
* `PUT /api/v1/geofences/:id` — редактирование границ

### 4. Стадо и животные

* `GET /api/v1/animals` — список всех животных с фильтрами по статусу (в зоне, вне зоны, нет связи)
* `GET /api/v1/animals/:id` — детальная карточка животного
* `POST /api/v1/animals/:id/assign-collar` — привязка ошейника
* `POST /api/v1/animals/:id/steer` — запуск маршрутного перегона стада

### 5. Оповещения (Alerts)

* `GET /api/v1/alerts` — активные и исторические инциденты (выход за забор, потеря связи)
* `PUT /api/v1/alerts/:id/resolve` — отметка о прочтении / закрытии инцидента

---

## 🚀 Запуск и разработка

```bash
cd server
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:db:push
npm run prisma:seed
npm run start:dev
```
Сервер запустится на `http://localhost:4000`.

## Environment variables

See `.env.example` (placeholders only). Required: `DATABASE_URL`, `JWT_SECRET` (at least 32 characters, not an example value). In production also `CORS_ORIGINS`. The server reads `PORT` (Render sets it) and listens on `0.0.0.0`. The server refuses to start if the configuration is invalid. `MockModule` is mounted only when `NODE_ENV` is not `production`.

Migrations: `npm run prisma:migrate:deploy` (never run against a database you have not backed up). If a database was created earlier with `db push`, mark the baseline once with `prisma migrate resolve --applied 0_init`.
