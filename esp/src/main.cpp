// Qamqor smart collar firmware: GPS -> HTTPS telemetry -> sound/vibration commands from the server.
// Contract: docs/architecture/api-contract.md, docs/architecture/device-code-protocol.md.
#include <Arduino.h>
#include "actuators.h"
#include "config.h"
#include "gps.h"
#include "net.h"
#include "secrets.h"

static uint32_t g_nextSendAt = 0;  // millis() deadline
static bool g_waiting = false;

static bool codeIsValid(const char *c) {
  if (strlen(c) != 8) return false;
  for (int i = 0; i < 8; i++)
    if (c[i] < '0' || c[i] > '9') return false;
  return true;
}

static void schedule(int sec) {
  g_nextSendAt = millis() + (uint32_t)sec * 1000UL;
  g_waiting = true;
  Serial.printf("[main] next attempt in %d s\n", sec);
}

[[noreturn]] static void halt(const char *why) {
  Serial.printf("[main] FATAL: %s\n", why);
  actuatorsOff();
  while (true) delay(1000);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Qamqor collar ===");
  if (!codeIsValid(DEVICE_CODE)) halt("DEVICE_CODE in secrets.h must be exactly 8 digits");
  Serial.printf("[main] device code %s, server %s\n", DEVICE_CODE, SERVER_HOST);
  actuatorsBegin();
  gpsBegin();
  schedule(0);
}

void loop() {
  gpsPump();
  if (g_waiting && (int32_t)(millis() - g_nextSendAt) < 0) {
    delay(5);
    return;
  }
  g_waiting = false;

  if (!wifiEnsure()) { schedule(BACKOFF_MIN_SEC); return; }
  if (!timeSync()) { schedule(BACKOFF_MIN_SEC); return; }  // TLS and the timestamp need a valid clock

  bool haveFix = gpsWaitForFix(GPS_FIX_WAIT_MS);
  GpsFix fix = gpsGet();
  double lat, lng, accuracy;
  if (haveFix && fix.valid) {
    lat = fix.lat; lng = fix.lng; accuracy = fix.accuracy;
    Serial.printf("[gps] fix %.6f, %.6f acc %.1f m sats %d\n", lat, lng, accuracy, fix.satellites);
  } else if (gpsLastKnown(lat, lng)) {
    // Contract requires coordinates. Send the last known point with a deliberately bad accuracy:
    // the server treats it as zone UNKNOWN (actuators off) and raises GPS_LOST.
    accuracy = ACCURACY_NO_FIX_M;
    Serial.println("[gps] no fix, sending last known position with accuracy 999 m");
  } else {
    Serial.println("[gps] no fix yet and no earlier position: nothing to send");
    schedule(NO_FIX_RETRY_SEC);
    return;
  }

  SendOutcome out = sendTelemetry(lat, lng, accuracy, fix.valid ? fix.speedKmh : 0, fix.hdop, fix.satellites);
  Serial.printf("[main] result %d\n", (int)out.result);
  schedule(out.nextIntervalSec);
}
