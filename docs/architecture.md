# Qamqor Architecture Overview

## 1. System Components
- **Hardware (Target)**: ESP32 + GNSS GPS + LTE CAT-M1/NB-IoT/2G Smart Livestock Collar.
- **Ingestion Gateway**: Fast, minimal `POST /api/v1/device/telemetry` endpoint designed for low-power intermittent transmission and Deep Sleep cycles.
- **Backend API**: NestJS modular application handling authentication, farm hierarchy, animal tracking, geofence polygon checks, alerts, and real-time events.
- **Database**: PostgreSQL 16 with PostGIS extension for spatial index (`GIST`) and polygon boundary containment queries (`ST_Contains`, `ST_DWithin`).
- **Web Dashboard**: Next.js 15, Tailwind CSS, MapLibre GL for farmer operations, geofence drawing, and telemetry visualization.
- **Simulator**: Virtual livestock flock generator for testing coordinates, speed, boundaries, and alerts without physical hardware.

## 2. Ingestion Flow
1. ESP32 wakes up from Deep Sleep every 5–15 min.
2. Acquires GPS fix (lat, lng, accuracy).
3. Connects to cellular network and sends HTTP POST with Bearer token.
4. Backend verifies device authenticity, saves telemetry point.
5. PostGIS checks point against active pasture polygon.
6. If outside, state changes to OUTSIDE, incident/alert is logged.
7. Backend responds with `200 OK` containing `nextInterval`.
8. ESP32 returns to Deep Sleep.

