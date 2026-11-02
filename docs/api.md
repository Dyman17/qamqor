# Qamqor API Specifications

Base URL: `/api/v1`

## 1. Device Ingestion Endpoint
- **URL**: `POST /api/v1/device/telemetry`
- **Auth**: `Authorization: Bearer <DEVICE_TOKEN>`
- **Request Body**:
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
- **Response `200 OK`**:
```json
{
  "success": true,
  "serverTime": "2026-11-02T18:00:01.000Z",
  "nextInterval": 300,
  "configVersion": 1
}
```

## 2. Authentication & Farmer APIs
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/farms/current`
- `GET /api/v1/animals`
- `POST /api/v1/animals`
- `GET /api/v1/devices`
- `POST /api/v1/devices`
- `GET /api/v1/geofences`
- `POST /api/v1/geofences`
- `GET /api/v1/alerts`
- `PATCH /api/v1/alerts/:id`
- `GET /api/v1/analytics/overview`

