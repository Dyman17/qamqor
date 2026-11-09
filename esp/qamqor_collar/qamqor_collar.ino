// =====================================================================================
// Qamqor smart collar firmware, ONE FILE. Flash this sketch with the Arduino IDE
// (or build it with PlatformIO: esp/platformio.ini points src_dir at this folder).
//
// Board:    "ESP32 Dev Module"
// Core:     Arduino-ESP32 2.x (tested with 2.0.17; the legacy driver/i2s.h API is used,
//           it is NOT available in the same form in core 3.x)
// Libraries (Library Manager):
//   - SparkFun MAX3010x Pulse and Proximity Sensor Library   (MAX30105.h, heartRate.h)
//   - TinyGPSPlus                (Mikal Hart)
//   - ArduinoJson                (version 7.x)
//
// Wiring (owner's tested hardware):
//   Vibration motor module : GPIO18 (HIGH = on)
//   Active buzzer module   : GPIO19 (HIGH = on, no tone control)
//   GPS NEO-6M             : module TX -> GPIO16 (RX2), module RX -> GPIO17 (TX2), 9600 baud
//   MAX30102 pulse sensor  : SDA -> GPIO21, SCL -> GPIO22 (I2C)
//   Speaker MAX98357A      : BCLK -> GPIO26, LRC -> GPIO25, DIN -> GPIO27 (I2S, 16 kHz, 16 bit, mono left)
//
// Protocol: docs/architecture/api-contract.md and device-code-protocol.md.
// Telemetry always carries the code, GPS (if there is a fix), satellites, speed and heartRate.
// The server reply is accepted only if reply.code == DEVICE_CODE. Reply field "mode":
//   REAL / AUTO -> run the server's commands (sound + buzzer, then vibration)
//   PILOT       -> ignore the server's zone/signal data, run the built-in demo scenario
//
// The password is never printed to the Serial log.
// =====================================================================================

// ---------- USER SETTINGS ----------
#define WIFI_SSID "YOUR_WIFI"
#define WIFI_PASS "YOUR_PASSWORD"
#define DEVICE_CODE "12345678"  // replace with this collar's own 8 digits (the owner claims the same code in the app)
// -----------------------------------

#define TELEMETRY_URL "https://qamqor-api.onrender.com/api/v1/device/telemetry"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <Wire.h>
#include <time.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "driver/i2s.h"

// ---------- Pins ----------
#define PIN_VIBRATION 18
#define PIN_BUZZER 19
#define PIN_GPS_RX 16
#define PIN_GPS_TX 17
#define GPS_BAUD 9600
#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_I2S_BCLK 26
#define PIN_I2S_LRC 25
#define PIN_I2S_DIN 27

// ---------- Timing and limits ----------
#define DEFAULT_INTERVAL_SEC 300
#define MIN_INTERVAL_SEC 5
#define MAX_INTERVAL_SEC 3600
#define PILOT_INTERVAL_SEC 15        // in PILOT mode report more often so the demo shows live data
#define NO_FIX_RETRY_SEC 30
#define GPS_MAX_AGE_MS 10000
#define HTTP_TIMEOUT_MS 30000        // Render free plan cold start can take ~30 s
#define WIFI_CONNECT_TIMEOUT_MS 20000
#define NTP_WAIT_MS 15000
#define BACKOFF_MIN_SEC 10
#define BACKOFF_MAX_SEC 300
#define ACCURACY_PER_HDOP_M 5.0      // assumption: accuracy (m) ~ HDOP * 5
#define ACCURACY_NO_FIX_M 999.0      // last known position with lost fix -> server zone UNKNOWN / GPS_LOST
#define VIBRATION_MAX_MS 5000
#define TEST_VIBRATION_MS 1000
#define TEST_SOUND_HZ 1000
#define TONE_MIN_HZ 100
#define TONE_MAX_HZ 3000
#define AUDIO_RATE 16000
#define AUDIO_AMPLITUDE 9000         // 0..32767

// ---------- Root CA (GTS Root R4) ----------
// Chain checked 2026-11-09: onrender.com <- Google Trust Services WE1 <- GTS Root R4. R4 is valid until 2036-06-22.
// SHA-256: 34:9D:FA:40:58:C5:E2:63:12:3B:39:8A:E7:95:57:3C:4E:13:13:C8:3F:E6:8F:93:55:6C:D5:E8:03:1B:3C:7D
// If TLS fails: openssl s_client -connect qamqor-api.onrender.com:443 -servername qamqor-api.onrender.com -showcerts
// and replace this PEM with the new self-signed root.
static const char ROOT_CA_PEM[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
)PEM";

// ---------- Types ----------
enum Mode : uint8_t { MODE_REAL = 0, MODE_PILOT = 1, MODE_AUTO = 2 };

// One step of a sound/vibration pattern. hz0 -> hz1 is a linear glide (rising tone when hz1 > hz0).
struct Step {
  uint16_t hz0, hz1;
  uint16_t ms;
  bool spk, buz, vib;
};

// Latest sensor values, written by loop() (core 1), read by the network task (core 0).
struct Snapshot {
  bool fixValid;     // fresh GPS fix
  bool haveLast;     // some position was valid at some time
  double lat, lng;   // current or last known
  double accuracy;
  double speedKmh;
  double hdop;       // < 0 unknown
  int satellites;    // < 0 unknown
  int heartRate;     // 0 = no valid pulse
};

// Command from the server reply, written by the network task, executed by loop().
struct Pending {
  bool has;
  bool sound;
  int hz;
  bool vib;
  int vibMs;
  int test;  // 0 none, 1 TEST_SOUND, 2 TEST_VIBRATION
};

// ---------- Shared state ----------
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
static Snapshot g_snap = {false, false, 0, 0, ACCURACY_NO_FIX_M, 0, -1, -1, 0};
static Pending g_pending = {false, false, 0, false, 0, 0};
static volatile uint8_t g_mode = MODE_REAL;  // last known mode; REAL until the first valid reply

// ---------- Sensors ----------
static TinyGPSPlus gps;
static HardwareSerial gpsSerial(2);
static MAX30105 particleSensor;
static bool pulseOk = false;
static float beatAvg = 0;
static uint32_t lastBeatMs = 0, lastGoodBeatMs = 0;

static void pulseTick() {
  if (!pulseOk) return;
  particleSensor.check();
  while (particleSensor.available()) {
    long ir = particleSensor.getFIFOIR();
    particleSensor.nextSample();
    uint32_t now = millis();
    if (ir < 50000) {  // no finger/skin contact
      beatAvg = 0;
      lastBeatMs = 0;
      continue;
    }
    if (checkForBeat(ir)) {
      if (lastBeatMs != 0) {
        float bpm = 60000.0f / (float)(now - lastBeatMs);
        if (bpm >= 40 && bpm <= 200) {
          beatAvg = beatAvg <= 0 ? bpm : 0.7f * beatAvg + 0.3f * bpm;
          lastGoodBeatMs = now;
        }
      }
      lastBeatMs = now;
    }
    if (beatAvg > 0 && now - lastGoodBeatMs > 10000) beatAvg = 0;  // stale
  }
}

static void gpsPump() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
}

static void snapshotUpdate() {
  static double lastLat = 0, lastLng = 0;
  static bool haveLast = false;
  Snapshot s;
  s.fixValid = gps.location.isValid() && gps.location.age() < GPS_MAX_AGE_MS;
  s.hdop = gps.hdop.isValid() ? gps.hdop.hdop() : -1;
  s.satellites = gps.satellites.isValid() ? (int)gps.satellites.value() : -1;
  s.speedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0;
  s.accuracy = ACCURACY_NO_FIX_M;
  if (s.fixValid) {
    lastLat = gps.location.lat();
    lastLng = gps.location.lng();
    haveLast = true;
    s.accuracy = s.hdop >= 0 ? max(1.0, s.hdop * ACCURACY_PER_HDOP_M) : ACCURACY_NO_FIX_M;
  }
  s.haveLast = haveLast;
  s.lat = lastLat;
  s.lng = lastLng;
  s.heartRate = (int)(beatAvg + 0.5f);
  portENTER_CRITICAL(&g_mux);
  g_snap = s;
  portEXIT_CRITICAL(&g_mux);
}

// ---------- Actuators: non-blocking pattern player ----------
static Step g_steps[16];
static uint8_t g_n = 0, g_i = 0;
static bool g_playing = false;
static uint32_t g_stepStart = 0;

static void outputsApply() {
  bool buz = g_playing && g_steps[g_i].buz;
  bool vib = g_playing && g_steps[g_i].vib;
  digitalWrite(PIN_BUZZER, buz ? HIGH : LOW);
  digitalWrite(PIN_VIBRATION, vib ? HIGH : LOW);
}

static void playStop() {
  g_playing = false;
  outputsApply();
}

static void playStart(const Step *steps, uint8_t n) {
  if (n == 0 || n > 16) return;
  memcpy(g_steps, steps, n * sizeof(Step));
  g_n = n;
  g_i = 0;
  g_stepStart = millis();
  g_playing = true;
  outputsApply();
}

static void playTick() {
  if (!g_playing) return;
  if (millis() - g_stepStart < g_steps[g_i].ms) return;
  g_i++;
  if (g_i >= g_n) {
    playStop();
    return;
  }
  g_stepStart = millis();
  outputsApply();
}

// ---------- Speaker: MAX98357A over I2S (legacy driver) ----------
static void setupAudio() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = AUDIO_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 128;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = true;  // silence when we stop writing
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = PIN_I2S_BCLK;
  pins.ws_io_num = PIN_I2S_LRC;
  pins.data_out_num = PIN_I2S_DIN;
  pins.data_in_num = I2S_PIN_NO_CHANGE;
  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK || i2s_set_pin(I2S_NUM_0, &pins) != ESP_OK) {
    Serial.println("[audio] I2S setup failed, speaker disabled");
    return;
  }
  i2s_zero_dma_buffer(I2S_NUM_0);
}

// Sine generator, one small chunk per call so loop() never blocks. Frequency follows the current step's glide.
static int16_t g_abuf[128];
static size_t g_alen = 0, g_aoff = 0;  // bytes
static float g_aphase = 0;

static void audioPump() {
  if (g_alen > g_aoff) {
    size_t w = 0;
    i2s_write(I2S_NUM_0, (uint8_t *)g_abuf + g_aoff, g_alen - g_aoff, &w, 0);
    g_aoff += w;
    if (g_aoff < g_alen) return;  // DMA full, try again next loop
  }
  g_alen = g_aoff = 0;
  if (!g_playing || !g_steps[g_i].spk) return;
  const Step &s = g_steps[g_i];
  float prog = s.ms ? (float)(millis() - g_stepStart) / (float)s.ms : 0;
  if (prog > 1) prog = 1;
  float f = s.hz0 + ((float)s.hz1 - (float)s.hz0) * prog;
  float inc = 2.0f * PI * f / AUDIO_RATE;
  for (int i = 0; i < 128; i++) {
    g_abuf[i] = (int16_t)(sinf(g_aphase) * AUDIO_AMPLITUDE);
    g_aphase += inc;
    if (g_aphase > 2.0f * PI) g_aphase -= 2.0f * PI;
  }
  g_alen = sizeof g_abuf;
  size_t w = 0;
  i2s_write(I2S_NUM_0, g_abuf, g_alen, &w, 0);
  g_aoff = w;
}

// ---------- Server-driven effects (REAL / AUTO) ----------
static void startBeeps(int hz, bool vib, int vibMs) {
  hz = constrain(hz, TONE_MIN_HZ, TONE_MAX_HZ);
  Step st[8];
  uint8_t n = 0;
  if (hz > 0) {
    for (int k = 0; k < 3; k++) {
      st[n++] = {(uint16_t)hz, (uint16_t)min(hz * 3 / 2, 5000), 250, true, true, false};  // rising tone + buzzer
      st[n++] = {0, 0, 150, false, false, false};
    }
  }
  if (vib) st[n++] = {0, 0, (uint16_t)constrain(vibMs, 0, VIBRATION_MAX_MS), false, false, true};
  Serial.printf("[act] server effect: tone %d Hz, vibration %d ms\n", hz, vib ? vibMs : 0);
  playStart(st, n);
}

static void applyPending() {
  Pending p;
  portENTER_CRITICAL(&g_mux);
  p = g_pending;
  g_pending.has = false;
  portEXIT_CRITICAL(&g_mux);
  if (!p.has || g_mode == MODE_PILOT) return;  // PILOT ignores the server's signals
  if (p.test == 1) {
    Serial.println("[cmd] TEST_SOUND");
    startBeeps(TEST_SOUND_HZ, false, 0);
  } else if (p.test == 2) {
    Serial.println("[cmd] TEST_VIBRATION");
    startBeeps(0, true, TEST_VIBRATION_MS);
  } else {
    startBeeps(p.sound ? p.hz : 0, p.vib, p.vibMs);
  }
}

// ---------- PILOT demo scenario (built in, loops) ----------
// green (quiet) -> yellow -> orange -> escape -> return (quiet) -> green ...
static const Step PAT_YELLOW[] = {  // rising-tone speaker beeps + buzzer chirps
    {500, 1100, 150, true, true, false}, {700, 1300, 150, true, false, false}, {0, 0, 400, false, false, false}};
static const Step PAT_ORANGE[] = {  // vibration pulses with sound
    {900, 900, 300, true, true, true}, {0, 0, 300, false, false, false}};
static const Step PAT_ESCAPE[] = {  // strong alternating sound + vibration
    {1600, 1600, 200, true, true, true}, {800, 800, 200, true, false, false}};

struct Phase {
  const char *name;
  uint32_t ms;
  const Step *pat;
  uint8_t n;
};
static const Phase PHASES[] = {
    {"GREEN (quiet)", 10000, nullptr, 0},
    {"YELLOW", 6000, PAT_YELLOW, 3},
    {"ORANGE", 6000, PAT_ORANGE, 2},
    {"ESCAPE", 4000, PAT_ESCAPE, 2},
    {"RETURN (quiet)", 10000, nullptr, 0},
};
static uint8_t g_phase = 0;
static uint32_t g_phaseStart = 0;
static bool g_pilotRunning = false;

static void pilotEnter(uint8_t i) {
  g_phase = i % (sizeof PHASES / sizeof PHASES[0]);
  g_phaseStart = millis();
  playStop();
  Serial.printf("[pilot] phase %s\n", PHASES[g_phase].name);
}

static void pilotTick() {
  if (!g_pilotRunning) {
    g_pilotRunning = true;
    pilotEnter(0);
  }
  if (millis() - g_phaseStart >= PHASES[g_phase].ms) pilotEnter(g_phase + 1);
  const Phase &p = PHASES[g_phase];
  if (p.pat && !g_playing) playStart(p.pat, p.n);  // repeat the pattern for the whole phase
}

// ---------- Network (runs in its own task on core 0, so sensors and sound never wait for HTTP) ----------
static bool timeValid() { return time(nullptr) > 1700000000; }

static bool wifiEnsure() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.printf("[wifi] connecting to \"%s\" (password: ********)\n", WIFI_SSID);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) vTaskDelay(250 / portTICK_PERIOD_MS);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] connection failed");
    return false;
  }
  Serial.printf("[wifi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

static bool timeSync() {
  if (timeValid()) return true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t start = millis();
  while (!timeValid() && millis() - start < NTP_WAIT_MS) vTaskDelay(250 / portTICK_PERIOD_MS);
  Serial.println(timeValid() ? "[time] NTP synced" : "[time] NTP failed");
  return timeValid();
}

static int clampInterval(long sec) { return (int)constrain(sec, (long)MIN_INTERVAL_SEC, (long)MAX_INTERVAL_SEC); }

static int g_failures = 0;  // consecutive network / 5xx failures -> backoff 10, 20, 40 ... 300 s
static int nextBackoff() {
  long v = (long)BACKOFF_MIN_SEC << min(g_failures, 5);
  g_failures++;
  return (int)min(v, (long)BACKOFF_MAX_SEC);
}

// Sends one ping and processes the reply. Returns seconds until the next attempt.
static int sendTelemetry() {
  Snapshot s;
  portENTER_CRITICAL(&g_mux);
  s = g_snap;
  portEXIT_CRITICAL(&g_mux);

  char ts[25];
  time_t now = time(nullptr);
  struct tm tmv;
  gmtime_r(&now, &tmv);
  strftime(ts, sizeof ts, "%Y-%m-%dT%H:%M:%SZ", &tmv);

  JsonDocument req;
  req["code"] = DEVICE_CODE;
  req["timestamp"] = ts;
  bool withCoords = s.haveLast;
  if (withCoords) {
    // Lost fix: the last known point goes out with accuracy 999 m (server: zone UNKNOWN, GPS_LOST).
    req["latitude"] = serialized(String(s.lat, 6));
    req["longitude"] = serialized(String(s.lng, 6));
    req["accuracy"] = serialized(String(s.fixValid ? s.accuracy : ACCURACY_NO_FIX_M, 1));
  } else {
    Serial.println("[gps] no fix yet: sending pulse/status without coordinates");
  }
  int rssi = WiFi.RSSI();
  if (rssi >= -130 && rssi <= 0) req["signal"] = rssi;
  req["speedKmh"] = serialized(String(constrain(s.fixValid ? s.speedKmh : 0.0, 0.0, 300.0), 1));
  if (s.hdop >= 0 && s.hdop <= 99) req["hdop"] = serialized(String(s.hdop, 1));
  if (s.satellites >= 0 && s.satellites <= 64) req["satellites"] = s.satellites;
  if (s.heartRate > 0) req["heartRate"] = s.heartRate;
  else req["heartRate"] = nullptr;
  String body;
  serializeJson(req, body);

  WiFiClientSecure client;
  client.setCACert(ROOT_CA_PEM);
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, TELEMETRY_URL)) {
    Serial.println("[http] begin failed");
    return nextBackoff();
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
    return nextBackoff();
  }
  String payload = http.getString();
  String retryAfter = http.header("Retry-After");
  http.end();
  Serial.printf("[http] status %d, %u bytes\n", status, (unsigned)payload.length());

  JsonDocument res;
  DeserializationError err = deserializeJson(res, payload);
  if (err) Serial.printf("[http] response is not JSON: %s\n", err.c_str());

  if (status != 200) {  // errors never start the actuators
    const char *eKind = res["error"] | "?";
    const char *eMsg = res["message"] | "";
    Serial.printf("[http] error %s: %s\n", eKind, eMsg);
    if (status >= 500) return nextBackoff();
    g_failures = 0;
    if (status == 401) return DEFAULT_INTERVAL_SEC;
    if (status == 429) {
      long ra = res["retryAfterSec"] | (retryAfter.length() ? retryAfter.toInt() : 60L);
      return clampInterval(ra);
    }
    return withCoords ? 60 : NO_FIX_RETRY_SEC;  // 400
  }

  // Accept only if the reply carries our own code.
  const char *rcode = res["code"] | "";
  bool okFlag = res["success"].as<bool>();
  if (err || !okFlag || strcmp(rcode, DEVICE_CODE) != 0) {
    Serial.printf("[http] reply REJECTED (code \"%s\" does not match, or not a success reply)\n", rcode);
    g_failures = 0;
    return DEFAULT_INTERVAL_SEC;
  }
  g_failures = 0;

  // Mode (default stays as is when the field is absent or unknown).
  const char *m = res["mode"] | "";
  uint8_t newMode = g_mode;
  if (!strcmp(m, "REAL")) newMode = MODE_REAL;
  else if (!strcmp(m, "PILOT")) newMode = MODE_PILOT;
  else if (!strcmp(m, "AUTO")) newMode = MODE_AUTO;
  if (newMode != g_mode) Serial.printf("[srv] mode -> %s\n", m);
  g_mode = newMode;

  const char *zone = res["zone"] | "UNKNOWN";
  bool sound = res["sound"] | false;
  bool vibrate = res["vibrate"] | false;
  int tone = res["toneFrequencyHz"] | 0;
  int vibMs = res["vibrateDurationMs"] | 0;
  long next = res["nextInterval"] | (long)DEFAULT_INTERVAL_SEC;
  Serial.printf("[srv] mode=%s zone=%s sound=%d (%d Hz) vibrate=%d (%d ms) next=%ld s\n", m, zone, sound, tone, vibrate, vibMs, next);
  const char *msg = res["warningMessage"] | "";
  if (msg[0]) Serial.printf("[srv] %s\n", msg);

  Pending p = {false, false, 0, false, 0, 0};
  const char *ctype = res["command"]["type"] | "";
  if (!strcmp(ctype, "TEST_SOUND")) { p.has = true; p.test = 1; }
  else if (!strcmp(ctype, "TEST_VIBRATION")) { p.has = true; p.test = 2; }
  else if ((sound && tone > 0) || (vibrate && vibMs > 0)) {
    p.has = true;
    p.sound = sound && tone > 0;
    p.hz = tone;
    p.vib = vibrate && vibMs > 0;
    p.vibMs = vibMs;
  }
  if (p.has) {
    portENTER_CRITICAL(&g_mux);
    g_pending = p;
    portEXIT_CRITICAL(&g_mux);
  }

  int interval = clampInterval(next);
  if (g_mode == MODE_PILOT) interval = min(interval, (int)PILOT_INTERVAL_SEC);
  return interval;
}

static void netTask(void *) {
  vTaskDelay(2000 / portTICK_PERIOD_MS);  // let the sensors produce a first snapshot
  for (;;) {
    int wait;
    if (!wifiEnsure()) wait = BACKOFF_MIN_SEC;
    else if (!timeSync()) wait = BACKOFF_MIN_SEC;  // TLS and the timestamp need a valid clock
    else wait = sendTelemetry();
    Serial.printf("[net] next attempt in %d s\n", wait);
    vTaskDelay((uint32_t)wait * 1000 / portTICK_PERIOD_MS);
  }
}

// ---------- Setup / loop ----------
static bool codeIsValid(const char *c) {
  if (strlen(c) != 8) return false;
  for (int i = 0; i < 8; i++)
    if (c[i] < '0' || c[i] > '9') return false;
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Qamqor collar ===");
  if (!codeIsValid(DEVICE_CODE)) {
    for (;;) {
      Serial.println("FATAL: DEVICE_CODE must be exactly 8 digits");
      delay(2000);
    }
  }
  Serial.printf("[main] device code %s\n", DEVICE_CODE);

  pinMode(PIN_VIBRATION, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_VIBRATION, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  Wire.begin(PIN_SDA, PIN_SCL);
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
    pulseOk = true;
    Serial.println("[pulse] MAX30102 ready");
  } else {
    Serial.println("[pulse] MAX30102 not found, heartRate will be null");
  }

  setupAudio();

  xTaskCreatePinnedToCore(netTask, "net", 20480, NULL, 1, NULL, 0);
}

void loop() {
  static uint8_t lastMode = MODE_REAL;
  static uint32_t lastSnap = 0;

  pulseTick();
  gpsPump();

  if (g_mode != lastMode) {  // mode switched: drop whatever is playing
    playStop();
    g_pilotRunning = false;
    lastMode = g_mode;
  }
  if (g_mode == MODE_PILOT) pilotTick();
  else applyPending();

  playTick();
  audioPump();

  if (millis() - lastSnap >= 500) {
    lastSnap = millis();
    snapshotUpdate();
  }
  delay(1);
}
