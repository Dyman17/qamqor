# Qamqor API Specifications

Base URL: `/api/v1`

---

## 1. Device Ingestion Endpoints (ESP32)

### 1.1 GPS & Telemetry Ingestion
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

---

## 2. ESP32-CAM Endpoints

### 2.1 Upload Snapshot (from ESP32-CAM)
- **URL**: `POST /api/v1/camera/upload`
- **Auth**: `Authorization: Bearer <DEVICE_TOKEN>`
- **Body**: `multipart/form-data` with field `image` (JPEG) OR JSON `{ "deviceId": "QAM-0002", "imageBase64": "..." }`
- **Response `200 OK`**:
```json
{
  "success": true,
  "snapshotId": "uuid",
  "imageUrl": "/api/v1/camera/snapshots/image/...",
  "capturedAt": "2026-11-02T18:00:00.000Z"
}
```

### 2.2 Poll Pending Commands (by ESP32-CAM)
- **URL**: `GET /api/v1/camera/commands?deviceId=QAM-0002`
- **Auth**: `Authorization: Bearer <DEVICE_TOKEN>`
- **Response**:
```json
{
  "hasCommand": true,
  "commandId": "uuid",
  "command": "CAPTURE_PHOTO",
  "payload": { "resolution": "SVGA" }
}
```

### 2.3 Request Immediate Photo (Farmer / Web)
- **URL**: `POST /api/v1/camera/request-photo`
- **Auth**: JWT
- **Body**: `{ "deviceId": "QAM-0002", "resolution": "SVGA" }`

### 2.4 Snapshots Gallery
- **URL**: `GET /api/v1/camera/snapshots?animalId=...`
- **Auth**: JWT

---

## 3. Mock & Manual Control Endpoints (Web Testing Tools)

### 3.1 Inject GPS & Battery Manually
- **URL**: `POST /api/v1/mock/inject-telemetry`
- **Auth**: JWT
- **Body**:
```json
{
  "animalId": "uuid-or-tag",
  "latitude": 43.6650,
  "longitude": 51.1750,
  "battery": 15,
  "accuracy": 3.0
}
```

### 3.2 Simulate Animal Escape (One-Click)
- **URL**: `POST /api/v1/mock/simulate-breach`
- **Auth**: JWT
- **Body**: `{ "animalId": "uuid" }`

### 3.3 Simulate Return to Pasture (One-Click)
- **URL**: `POST /api/v1/mock/simulate-return`
- **Auth**: JWT
- **Body**: `{ "animalId": "uuid" }`

### 3.4 Simulate Collar Camera Photo
- **URL**: `POST /api/v1/mock/inject-photo`
- **Auth**: JWT
- **Body**: `{ "animalId": "uuid" }`

---

## 4. Farmer REST APIs

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/farms`
- `GET /api/v1/farms/:id`
- `POST /api/v1/farms`
- `PATCH /api/v1/farms/:id`
- `GET /api/v1/animals`
- `GET /api/v1/animals/:id`
- `GET /api/v1/animals/:id/track`
- `POST /api/v1/animals`
- `PATCH /api/v1/animals/:id`
- `DELETE /api/v1/animals/:id`
- `GET /api/v1/devices`
- `GET /api/v1/devices/:id`
- `POST /api/v1/devices`
- `PATCH /api/v1/devices/:id`
- `DELETE /api/v1/devices/:id`
- `GET /api/v1/geofences`
- `POST /api/v1/geofences`
- `PATCH /api/v1/geofences/:id`
- `DELETE /api/v1/geofences/:id`
- `GET /api/v1/alerts`
- `GET /api/v1/alerts/stats`
- `PATCH /api/v1/alerts/:id/status`
- `GET /api/v1/analytics/overview`
