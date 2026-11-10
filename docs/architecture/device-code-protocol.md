Status: approved (owner decision 2026-11-09); cadence, signal cooldown and read-endpoint auth added 2026-11-10 (implementation defaults)

# ESP32 ↔ server: 8-digit device code

The owner's decision, verbatim in meaning:

1. Each ESP32 has an **8-digit code** in its firmware, digits only (`^[0-9]{8}$`). It is the device's identity.
2. The ESP32 sends all its data to the server **together with this code**.
3. The server's response **must contain the same code**.
4. The ESP32 accepts a response only if its code matches. Otherwise it discards the response.

## Server rules (implementation defaults)

- The owner registers ("claims") a collar in the dashboard or app by entering its 8-digit code. The code is unique across the system.
- **Open acceptance (owner decision, prototype: the ESP has no accounts).** Any well-formed code is accepted. The first ping from an unknown code creates an unclaimed device (`QAM-<code>`, no farm, no animal) and stores telemetry on it. The reply is 200 with the code echo, `nextInterval`, zone `UNKNOWN`, no signals, `mode: "REAL"` and `warningMessage: "Device not claimed yet"`. Claiming the code later (`POST /devices {code}`) attaches the existing record to the farm and keeps its history. Telemetry from a claimed code goes through the normal pipeline: zones, signals, alerts.
- A malformed code (not `^[0-9]{8}$`), a missing code, or a body code that differs from `X-Device-Code` gets 400 with `code: null`.
- Abuse limits: at most 500 unclaimed devices at once (429 beyond that); unclaimed devices with no ping for 7 days are deleted with their telemetry by the background job.
- Every telemetry response is JSON with a `code` field equal to the request's code, plus the command fields (zone, signal, next ping interval).
- Rate limit per IP and per code, to slow down guessing.
- **`nextInterval` (seconds until the next ping; the firmware must obey it):** unclaimed device -> `UNCLAIMED_PING_INTERVAL_SEC` (30); claimed device whose farm is "live" (someone has the web map's SSE stream open, plus `LIVE_LINGER_SEC` = 120 s after the last viewer left) -> `LIVE_PING_INTERVAL_SEC` (1, allowed 1..60); otherwise `NORMAL_PING_INTERVAL_SEC` (300). An animal outside the fence gets `EMERGENCY_PING_INTERVAL_SEC` (60), never longer than the live interval (the minimum is used). Live state is kept in server memory (single instance).
- **Signals are episodic:** per animal and per kind (sound, vibration) at most one signal per `SIGNAL_COOLDOWN_SEC` (30 s). Inside the cooldown the reply has `sound`/`vibrate` false, nothing is recorded or counted against the daily limit, `suppressedBy` stays null. Stale (`timestamp` not newer than the animal's last seen) and retried pings never deliver a signal.
- A fix the firmware marks unreliable (accuracy 999 with the last known position) raises GPS_LOST but does not overwrite the animal's position or last-seen time.
- The two read endpoints `GET /api/v1/device/telemetry?code=` and `GET /api/v1/device/stream` are for the web client, not for the collar: they need a JWT and `x-farm-id`, and only show devices of the caller's farm (unclaimed devices are never streamed). The collar uses only `POST /api/v1/device/telemetry`.
- `POST /devices/:id/rotate-secret` is removed: the code is the identity, no secret is checked.
- HTTPS only, through Render.

## Known risk (for the owner)

Open acceptance widens it: anyone can create unclaimed rows (bounded by the rate limits and the 500 cap, which an attacker can also fill, blocking new real collars until the 7-day cleanup frees slots), and anyone can spoof a code, including one an owner is about to claim, so history of an unclaimed device before the claim is not trustworthy. The owner accepted this for the prototype.

An 8-digit code is not a secret. Anyone who knows or guesses a claimed code can send fake positions for that collar. There are 10^8 combinations, and the rate limit slows guessing down.

If stronger protection is needed later, add an optional per-device secret or HMAC over the payload. Firmware changes can stay backward-compatible.
