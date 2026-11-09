// =====================================================================================
// Qamqor smart collar firmware (ESP32)
// Архитектура: ESP32 — исполнитель датчиков и актуаторов.
// Вся бизнес-логика, геозоны и сценарии находятся на сервере.
// =====================================================================================

// ---------- НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ ----------
#define WIFI_SSID "DD"
#define WIFI_PASS "dddddddd"
#define DEVICE_CODE "12345678"
// -------------------------------------------

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

// ---------- Пины оборудования ----------
#define PIN_VIBRATION 18      // Вибромотор (HIGH = вкл)
#define PIN_BUZZER 19         // ПРАВЫЙ звук: активный зуммер (HIGH = вкл)
#define PIN_GPS_RX 16         // GPS NEO-6M TX -> ESP RX2
#define PIN_GPS_TX 17         // GPS NEO-6M RX <- ESP TX2
#define GPS_BAUD 9600
#define PIN_SDA 21            // Пульсометр MAX30102 I2C
#define PIN_SCL 22
#define PIN_I2S_BCLK 26       // ЛЕВЫЙ звук: динамик с усилителем MAX98357A (I2S)
#define PIN_I2S_LRC 25
#define PIN_I2S_DIN 27

// ---------- Тайминги ----------
#define SEND_INTERVAL_SEC 1          // Опрос строго каждую секунду
#define GPS_MAX_AGE_MS 10000
#define HTTP_TIMEOUT_MS 15000
#define WIFI_CONNECT_TIMEOUT_MS 20000
#define NTP_WAIT_MS 15000
#define ACCURACY_PER_HDOP_M 5.0
#define ACCURACY_NO_FIX_M 999.0
#define AUDIO_RATE 16000
#define AUDIO_AMPLITUDE 9000

// ---------- Корневой сертификат GTS Root R4 ----------
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

// ---------- Структуры данных ----------
struct Snapshot {
  bool fixValid;
  bool haveLast;
  double lat, lng;
  double accuracy;
  double speedKmh;
  double hdop;
  int satellites;
  int heartRate;
};

// Пакет прямого управления актуаторами с сервера
struct ActuatorCommand {
  bool has;
  uint16_t speakerHz;
  uint16_t speakerMs;
  uint16_t buzzerMs;
  uint16_t vibrateMs;
};

// ---------- Разделяемое состояние между ядрами FreeRTOS ----------
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
static Snapshot g_snap = {false, false, 0, 0, ACCURACY_NO_FIX_M, 0, -1, -1, 0};
static ActuatorCommand g_pending = {false, 0, 0, 0, 0};

// Времена автоматического выключения каждого актуатора (мс)
static uint32_t g_speakerOffMs = 0;
static uint16_t g_speakerHz = 0;
static uint32_t g_buzzerOffMs = 0;
static uint32_t g_vibratorOffMs = 0;

// ---------- Датчики (Core 1) ----------
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
    if (ir < 50000) {
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
    if (beatAvg > 0 && now - lastGoodBeatMs > 10000) beatAvg = 0;
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

// ---------- Левый динамик: MAX98357A через I2S ----------
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
  cfg.tx_desc_auto_clear = true;
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

static int16_t g_abuf[128];
static size_t g_alen = 0, g_aoff = 0;
static float g_aphase = 0;

static void audioPump() {
  if (g_alen > g_aoff) {
    size_t w = 0;
    i2s_write(I2S_NUM_0, (uint8_t *)g_abuf + g_aoff, g_alen - g_aoff, &w, 0);
    g_aoff += w;
    if (g_aoff < g_alen) return;
  }
  g_alen = g_aoff = 0;
  if (millis() >= g_speakerOffMs || g_speakerHz <= 0) return;

  float inc = 2.0f * PI * (float)g_speakerHz / AUDIO_RATE;
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

// ---------- Применение команд сервера (Core 1) ----------
static void applyActuators() {
  ActuatorCommand cmd;
  portENTER_CRITICAL(&g_mux);
  cmd = g_pending;
  g_pending.has = false;
  portEXIT_CRITICAL(&g_mux);

  uint32_t now = millis();
  if (cmd.has) {
    if (cmd.speakerMs > 0 && cmd.speakerHz > 0) {
      g_speakerHz = cmd.speakerHz;
      g_speakerOffMs = now + cmd.speakerMs;
      Serial.printf("[act] Левый динамик: %d Гц, %d мс\n", cmd.speakerHz, cmd.speakerMs);
    }
    if (cmd.buzzerMs > 0) {
      g_buzzerOffMs = now + cmd.buzzerMs;
      Serial.printf("[act] Правый зуммер: %d мс\n", cmd.buzzerMs);
    }
    if (cmd.vibrateMs > 0) {
      g_vibratorOffMs = now + cmd.vibrateMs;
      Serial.printf("[act] Вибрация: %d мс\n", cmd.vibrateMs);
    }
  }

  // Обновление состояния пинов
  digitalWrite(PIN_BUZZER, (millis() < g_buzzerOffMs) ? HIGH : LOW);
  digitalWrite(PIN_VIBRATION, (millis() < g_vibratorOffMs) ? HIGH : LOW);
  if (millis() >= g_speakerOffMs) {
    g_speakerHz = 0;
  }
}

// ---------- Сетевая задача (Core 0) ----------
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

static void sendTelemetry() {
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
  if (s.haveLast) {
    req["latitude"] = serialized(String(s.lat, 6));
    req["longitude"] = serialized(String(s.lng, 6));
    req["accuracy"] = serialized(String(s.fixValid ? s.accuracy : ACCURACY_NO_FIX_M, 1));
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
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Code", DEVICE_CODE);

  int status = http.POST(body);
  if (status <= 0) {
    Serial.printf("[http] request failed: %s\n", HTTPClient::errorToString(status).c_str());
    http.end();
    return;
  }
  String payload = http.getString();
  http.end();

  if (status != 200) {
    Serial.printf("[http] status %d: %s\n", status, payload.c_str());
    return;
  }

  JsonDocument res;
  DeserializationError err = deserializeJson(res, payload);
  if (err || !res["success"].as<bool>()) {
    Serial.println("[http] response invalid JSON or not success");
    return;
  }

  const char *rcode = res["code"] | "";
  if (strcmp(rcode, DEVICE_CODE) != 0) return;

  // ---------- Разбор указаний сервера ----------
  ActuatorCommand cmd = {false, 0, 0, 0, 0};

  // 1. Команды тестирования
  const char *ctype = res["command"]["type"] | "";
  if (!strcmp(ctype, "TEST_SPEAKER") || !strcmp(ctype, "TEST_SOUND")) {
    cmd.has = true;
    cmd.speakerHz = 1200;
    cmd.speakerMs = 800; // Левый динамик
  } else if (!strcmp(ctype, "TEST_BUZZER")) {
    cmd.has = true;
    cmd.buzzerMs = 500;  // Правый зуммер
  } else if (!strcmp(ctype, "TEST_VIBRATION")) {
    cmd.has = true;
    cmd.vibrateMs = 1000; // Вибрация
  }

  // 2. Прямые миллисекунды от сервера (если сервер передал)
  int spkMs = res["speakerMs"] | 0;
  int spkHz = res["speakerHz"] | 0;
  int buzMs = res["buzzerMs"] | 0;
  int vibMs = res["vibrateMs"] | 0;

  if (spkMs > 0 && spkHz > 0) {
    cmd.has = true;
    cmd.speakerHz = constrain(spkHz, 100, 3000);
    cmd.speakerMs = min(spkMs, 5000);
  }
  if (buzMs > 0) {
    cmd.has = true;
    cmd.buzzerMs = min(buzMs, 5000);
  }
  if (vibMs > 0) {
    cmd.has = true;
    cmd.vibrateMs = min(vibMs, 5000);
  }

  // 3. Стандартные флаги геозоны
  bool sound = res["sound"] | false;
  int tone = res["toneFrequencyHz"] | 0;
  bool vibrate = res["vibrate"] | false;
  int vDuration = res["vibrateDurationMs"] | 0;

  if (sound && tone > 0 && cmd.speakerMs == 0) {
    cmd.has = true;
    cmd.speakerHz = constrain(tone, 100, 3000);
    cmd.speakerMs = 600;
  }
  if (vibrate && vDuration > 0 && cmd.vibrateMs == 0) {
    cmd.has = true;
    cmd.vibrateMs = min(vDuration, 5000);
  }

  if (cmd.has) {
    portENTER_CRITICAL(&g_mux);
    g_pending = cmd;
    portEXIT_CRITICAL(&g_mux);
  }
}

static void netTask(void *) {
  vTaskDelay(2000 / portTICK_PERIOD_MS);
  for (;;) {
    if (wifiEnsure() && timeSync()) {
      sendTelemetry();
    }
    // Строго 1 секунда между попытками
    vTaskDelay(SEND_INTERVAL_SEC * 1000 / portTICK_PERIOD_MS);
  }
}

// ---------- setup() и loop() ----------
static bool codeIsValid(const char *c) {
  if (strlen(c) != 8) return false;
  for (int i = 0; i < 8; i++)
    if (c[i] < '0' || c[i] > '9') return false;
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Qamqor collar (Thin Client) ===");
  if (!codeIsValid(DEVICE_CODE)) {
    for (;;) {
      Serial.println("FATAL: DEVICE_CODE must be exactly 8 digits");
      delay(2000);
    }
  }
  Serial.printf("[main] device code: %s\n", DEVICE_CODE);

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

  // Фоновая сетевая задача на Core 0
  xTaskCreatePinnedToCore(netTask, "net", 20480, NULL, 1, NULL, 0);
}

void loop() {
  static uint32_t lastSnap = 0;

  pulseTick();
  gpsPump();

  applyActuators();
  audioPump();

  if (millis() - lastSnap >= 250) {
    lastSnap = millis();
    snapshotUpdate();
  }
  delay(1);
}
