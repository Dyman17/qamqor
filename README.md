# Qamqor (Қамқор) — IoT Smart Livestock Monitoring Platform

Аппаратно-программная IoT-система для мониторинга сельскохозяйственных животных, отслеживания их местоположения, контроля виртуальных пастбищ (Geofencing) и оперативного оповещения фермеров.

---

## 🏛 Архитектура монорепозитория

```text
qamqor/
├── apps/
│   ├── api/             # NestJS REST API + Ingestion Gateway + PostGIS Geofencing
│   ├── web/             # Next.js 15 Web Dashboard + MapLibre интерактивная карта
│   └── simulator/       # Симулятор смарт-ошейников ESP32 (Kazakhstan GPS flock)
├── packages/
│   ├── shared/          # Доменные типы, перечисления (жылқы, сиыр, түйе, қой)
│   ├── contracts/       # DTO контракты (включая ESP32 /api/v1/device/telemetry)
│   └── config/          # Базовые конфиги TypeScript / ESLint
├── infrastructure/
│   ├── docker/          # Dockerfile и SQL скрипты инициализации PostGIS
│   └── render/          # Конфигурация для облачного деплоя
├── docs/                # Архитектурная и API документация
├── docker-compose.yml   # Локальный запуск PostgreSQL 16 + PostGIS
├── render.yaml          # Инфраструктура в коде для Render Blueprint
└── package.json         # Управление монорепозиторием через pnpm workspaces
```

---

## 🚀 Быстрый старт

### 1. Установка зависимостей
```bash
pnpm install
```

### 2. Сборка общих пакетов
```bash
pnpm --filter @qamqor/shared run build
pnpm --filter @qamqor/contracts run build
```

### 3. Запуск локальной базы данных (PostGIS)
```bash
docker-compose up -d
```
Или используйте облачную базу (Neon / Render Postgres) указав `DATABASE_URL` в `.env`.

### 4. Генерация Prisma Client и применение схемы
```bash
pnpm prisma:generate
pnpm prisma:db:push
```

### 5. Запуск Backend API
```bash
pnpm dev:api
```
API будет доступен по адресу: `http://localhost:4000`
Эндпоинт приёма телеметрии: `POST http://localhost:4000/api/v1/device/telemetry`

### 6. Запуск Симулятора ошейников
В отдельном окне терминала:
```bash
pnpm dev:simulator
```
Симулятор автоматически генерирует координаты виртуального стада в степи, проверяет геозоны и тестирует реакцию сервера!

---

## 📡 Протокол ESP32 Ingestion
- **URL**: `POST /api/v1/device/telemetry`
- **Заголовок**: `Authorization: Bearer <DEVICE_TOKEN>`
- **Тело запроса**:
```json
{
  "deviceId": "QAM-0001",
  "timestamp": "2026-11-02T18:00:00.000Z",
  "latitude": 43.6501,
  "longitude": 51.1572,
  "accuracy": 4.5,
  "battery": 87,
  "signal": -75
}
```
- **Ответ сервера `200 OK`**:
```json
{
  "success": true,
  "serverTime": "2026-11-02T18:00:01.000Z",
  "nextInterval": 300,
  "configVersion": 1
}
```
*Примечание:* Если животное выходит за границу пастбища, сервер автоматически снижает `nextInterval` до 60 секунд, чтобы чаще получать координаты сбежавшего скота.

