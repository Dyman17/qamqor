#include "net.h"
#include "actuators.h"
#include "certs.h"
#include "config.h"
#include "secrets.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

bool timeValid() { return time(nullptr) > 1700000000; }  // after Nov 2023

bool wifiEnsure() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("[wifi] connecting to \"%s\" (password: ********)\n", WIFI_SSID);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] connection failed");
    return false;
  }
  Serial.printf("[wifi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

bool timeSync() {
  if (timeValid()) return true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t start = millis();
  while (!timeValid() && millis() - start < NTP_WAIT_MS) delay(250);
  Serial.println(timeValid() ? "[time] NTP synced" : "[time] NTP failed");
  return timeValid();
}

static int clampInterval(long sec) { return (int)constrain(sec, (long)MIN_INTERVAL_SEC, (long)MAX_INTERVAL_SEC); }

// Consecutive transient failures (network / 5xx) -> exponential backoff 10, 20, 40 ... 300 s.
static int g_failures = 0;
static int nextBackoff() {
  long v = (long)BACKOFF_MIN_SEC << min(g_failures, 5);
  g_failures++;
  return (int)min(v, (long)BACKOFF_MAX_SEC);
}

static void runCommand(JsonObjectConst cmd) {
  const char *type = cmd["type"] | "";
  if (!strcmp(type, "TEST_SOUND")) {
    Serial.println("[cmd] TEST_SOUND");
    playSound(TEST_SOUND_HZ);
  } else if (!strcmp(type, "TEST_VIBRATION")) {
    Serial.println("[cmd] TEST_VIBRATION");
    vibrateFor(TEST_VIBRATION_MS);
  } else {
    Serial.printf("[cmd] unknown command type \"%s\" ignored\n", type);
  }
}

SendOutcome sendTelemetry(double lat, double lng, double accuracy, double speedKmh, double hdop, int satellites) {
  // ---- Body ----
  char ts[25];
  time_t now = time(nullptr);
  struct tm tmv;
  gmtime_r(&now, &tmv);
  strftime(ts, sizeof ts, "%Y-%m-%dT%H:%M:%SZ", &tmv);

  JsonDocument req;
  req["code"] = DEVICE_CODE;
  req["timestamp"] = ts;
  req["latitude"] = serialized(String(lat, 6));
  req["longitude"] = serialized(String(lng, 6));
  req["accuracy"] = serialized(String(accuracy, 1));
  int rssi = WiFi.RSSI();
  if (rssi >= -130 && rssi <= 0) req["signal"] = rssi;
  req["speedKmh"] = serialized(String(constrain(speedKmh, 0.0, 300.0), 1));
  if (hdop >= 0 && hdop <= 99) req["hdop"] = serialized(String(hdop, 1));
  if (satellites >= 0 && satellites <= 64) req["satellites"] = satellites;
  String body;
  serializeJson(req, body);

  // ---- Request ----
  WiFiClientSecure client;
  client.setCACert(ROOT_CA_PEM);
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, TELEMETRY_URL)) {
    Serial.println("[http] begin failed");
    return {SendResult::NETWORK_ERROR, nextBackoff()};
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Code", DEVICE_CODE);
  const char *hdrs[] = {"Retry-After"};
  http.collectHeaders(hdrs, 1);

  Serial.printf("[http] POST %s\n[http] body: %s\n", TELEMETRY_URL, body.c_str());
  int status = http.POST(body);
  if (status <= 0) {
    Serial.printf("[http] request failed: %s\n", HTTPClient::errorToString(status).c_str());
    http.end();
    return {SendResult::NETWORK_ERROR, nextBackoff()};
  }
  String payload = http.getString();
  String retryAfter = http.header("Retry-After");
  http.end();
  Serial.printf("[http] status %d, %u bytes\n", status, (unsigned)payload.length());

  JsonDocument res;
  DeserializationError err = deserializeJson(res, payload);
  if (err) Serial.printf("[http] response is not JSON: %s\n", err.c_str());

  // ---- Errors: no actuators, ever ----
  if (status != 200) {
    const char *eKind = res["error"] | "?";
    const char *eMsg = res["message"] | "";
    Serial.printf("[http] error %s: %s\n", eKind, eMsg);
    if (status >= 500) return {SendResult::SERVER_ERROR, nextBackoff()};
    g_failures = 0;
    if (status == 401) return {SendResult::BAD_AUTH, DEFAULT_INTERVAL_SEC};
    if (status == 429) {
      long ra = res["retryAfterSec"] | (retryAfter.length() ? retryAfter.toInt() : 60L);
      return {SendResult::RATE_LIMITED, clampInterval(ra)};
    }
    return {SendResult::BAD_REQUEST, 60};  // 400: fix data/time, retry soon
  }

  // ---- Accept only if the code matches ----
  const char *rcode = res["code"] | "";
  bool okFlag = res["success"].as<bool>();
  if (err || !okFlag || strcmp(rcode, DEVICE_CODE) != 0) {
    Serial.printf("[http] response REJECTED (code \"%s\" does not match, or not a success reply)\n", rcode);
    g_failures = 0;
    return {SendResult::REJECTED_CODE, DEFAULT_INTERVAL_SEC};
  }
  g_failures = 0;

  const char *zone = res["zone"] | "UNKNOWN";
  bool sound = res["sound"] | false;
  bool vibrate = res["vibrate"] | false;
  int tone = res["toneFrequencyHz"] | 0;
  int vibMs = res["vibrateDurationMs"] | 0;
  long next = res["nextInterval"] | (long)DEFAULT_INTERVAL_SEC;
  Serial.printf("[srv] zone=%s sound=%d (%d Hz) vibrate=%d (%d ms) next=%ld s\n", zone, sound, tone, vibrate, vibMs, next);
  const char *msg = res["warningMessage"] | "";
  if (msg[0]) Serial.printf("[srv] %s\n", msg);

  // Sound pattern first, then vibration.
  if (sound && tone > 0) playSound(tone);
  if (vibrate && vibMs > 0) vibrateFor(vibMs);
  if (res["command"].is<JsonObjectConst>()) runCommand(res["command"].as<JsonObjectConst>());

  return {SendResult::OK, clampInterval(next)};
}
