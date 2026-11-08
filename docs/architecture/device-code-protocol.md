Status: approved (owner decision 2026-11-09)

# ESP32 ↔ server: 8-digit device code

The owner's decision, verbatim in meaning:

1. Each ESP32 has an **8-digit code** in its firmware, digits only (`^[0-9]{8}$`). It is the device's identity.
2. The ESP32 sends all its data to the server **together with this code**.
3. The server's response **must contain the same code**.
4. The ESP32 accepts a response only if its code matches. Otherwise it discards the response.

## Server rules (implementation defaults)

- The owner registers ("claims") a collar in the dashboard or app by entering its 8-digit code. The code is unique across the system.
- Telemetry with an unknown or unclaimed code gets 404/401 and is not stored. Telemetry from a claimed code goes through the normal pipeline: zones, signals, alerts.
- Every telemetry response is JSON with a `code` field equal to the request's code, plus the command fields (zone, signal, next ping interval).
- Rate limit per IP and per code, to slow down guessing.
- HTTPS only, through Render.

## Known risk (for the owner)

An 8-digit code is not a secret. Anyone who knows or guesses a claimed code can send fake positions for that collar. There are 10^8 combinations, and the rate limit slows guessing down.

If stronger protection is needed later, add an optional per-device secret or HMAC over the payload. Firmware changes can stay backward-compatible.
