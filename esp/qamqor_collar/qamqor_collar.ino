// =====================================================================================
// Qamqor smart collar firmware (ESP32)
// Архитектура: ESP32 — исполнитель датчиков и актуаторов.
// Вся бизнес-логика, геозоны и сценарии находятся на сервере.
// Реальный Wi-Fi вписывается ТОЛЬКО в git-ignored копию esp/local/... (см. esp/README.md).
// =====================================================================================

// ---------- НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ ----------
#define WIFI_SSID "YOUR_WIFI"
#define WIFI_PASS "YOUR_PASSWORD"
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
#include "esp_heap_caps.h"
#include "MAX30105.h"
#include "heartRate.h"
#include "driver/i2s.h"
#include "esp_timer.h"

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
#define FIRST_INTERVAL_SEC 5         // до первого успешного ответа
#define DEFAULT_INTERVAL_SEC 300     // если сервер не прислал nextInterval
#define MIN_INTERVAL_SEC 1
#define MAX_INTERVAL_SEC 3600
#define BACKOFF_START_SEC 2          // сеть/5xx: 2, 4, 8 ... до 60
#define BACKOFF_MAX_SEC 60
#define RETRY_400_SEC 60
#define RETRY_AUTH_SEC 300           // 401 / 403
#define RETRY_429_MIN_SEC 5
#define RETRY_429_MAX_SEC 3600
#define KEEPALIVE_MAX_INTERVAL_SEC 15  // TLS-соединение держим, только если следующий пинг не позже
#define GPS_MAX_AGE_MS 10000
#define HTTP_TIMEOUT_MS 25000        // холодный старт Render до ~30 с
#define WIFI_WAIT_MS 8000
#define WIFI_FAILS_BEFORE_FULL_RESET 3
#define ACCURACY_PER_HDOP_M 5.0
#define ACCURACY_NO_FIX_M 999.0
#define AUDIO_RATE 16000
#define AUDIO_AMPLITUDE 9000

// ---------- Ограничения актуаторов (безопасность животного, независимо от сервера) ----------
#define SPEAKER_MAX_MS 5000          // динамик: не дольше 5 с на команду
#define BUZZER_MAX_MS 5000           // зуммер: не дольше 5 с на команду
#define DUTY_WINDOW_SEC 30           // вибромотор, зуммер и динамик: каждый не более DUTY_BUDGET_MS в скользящем окне 30 с
#define DUTY_BUDGET_MS 5000
#define DUTY_MIN_USEFUL_MS 50
#define GUARD_STALE_MS 1000          // сторож: loop() не отметился дольше этого времени, актуаторы принудительно выключаются
#define GUARD_OVERDUE_MS 150         // сторож: актуатор работает дольше своего дедлайна на это время, выключаем

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

// Запрос на включение актуаторов из одного ответа сервера (длительности в мс)
struct ActuatorCommand {
  bool has;
  uint16_t speakerHz;
  uint16_t speakerMs;
  uint16_t speakerVolume;
  uint16_t buzzerMs;
  uint16_t vibrateMs;
  char type[20];  // для лога: тип команды или источник параметров
  char id[12];
};

// ---------- Разделяемое состояние между ядрами FreeRTOS ----------
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
static Snapshot g_snap = {false, false, 0, 0, ACCURACY_NO_FIX_M, 0, -1, -1, 0};
static ActuatorCommand g_pending = {};

// Состояние актуаторов (трогает только Core 1: applyActuators/audioPump)
static bool g_speakerActive = false;
static uint32_t g_speakerOffMs = 0;
static uint16_t g_speakerHz = 0;
static uint16_t g_speakerVolume = AUDIO_AMPLITUDE;
static bool g_buzzerActive = false;
static uint32_t g_buzzerOffMs = 0;
static bool g_vibActive = false;
static uint32_t g_vibOffMs = 0;
static bool g_audioOk = false;

// Независимый сторож (задача на Core 0). Все поля volatile, 32-битные записи атомарны.
// loop() пишет heartbeat и дедлайны; сторож только читает и взводит g_guardTrip.
static volatile uint32_t g_hbMs = 0;
static volatile bool g_hwSpkOn = false, g_hwBuzOn = false, g_hwVibOn = false;
static volatile uint32_t g_hwSpkEnd = 0, g_hwBuzEnd = 0, g_hwVibEnd = 0;
static volatile bool g_guardTrip = false;

// Скользящее окно расхода времени: секундные корзины, время 64-бит (esp_timer, не переполняется),
// поэтому окно корректно без допущений о переполнении millis().
struct DutyWindow {
  uint64_t sec[DUTY_WINDOW_SEC];
  uint32_t ms[DUTY_WINDOW_SEC];
};
static DutyWindow g_dutySpk, g_dutyBuz, g_dutyVib;
static uint64_t nowMs64() { return (uint64_t)esp_timer_get_time() / 1000ULL; }

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
    // Порог наличия пальца: ниже 25000 — датчик открыт
    if (ir < 25000) {
      if (lastGoodBeatMs > 0 && now - lastGoodBeatMs > 3000) {
        beatAvg = 0;
      }
      lastBeatMs = 0;
      continue;
    }
    if (checkForBeat(ir)) {
      if (lastBeatMs != 0) {
        float bpm = 60000.0f / (float)(now - lastBeatMs);
        if (bpm >= 45 && bpm <= 190) {
          // Первый замер берём сразу, дальше сглаживание 0.5/0.5
          if (beatAvg <= 0) {
            beatAvg = bpm;
          } else {
            beatAvg = 0.5f * beatAvg + 0.5f * bpm;
          }
          lastGoodBeatMs = now;
          Serial.printf("[pulse] beat, BPM %.0f (IR %ld)\n", beatAvg, ir);
        }
      }
      lastBeatMs = now;
    }
    if (beatAvg > 0 && now - lastGoodBeatMs > 4000) {
      beatAvg = 0;
    }
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
  g_audioOk = true;
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
  if (!g_speakerActive || g_speakerHz == 0) return;

  float inc = 2.0f * PI * (float)g_speakerHz / AUDIO_RATE;
  for (int i = 0; i < 128; i++) {
    g_abuf[i] = (int16_t)(sinf(g_aphase) * (float)g_speakerVolume);
    g_aphase += inc;
    if (g_aphase > 2.0f * PI) g_aphase -= 2.0f * PI;
  }
  g_alen = sizeof g_abuf;
  size_t w = 0;
  i2s_write(I2S_NUM_0, g_abuf, g_alen, &w, 0);
  g_aoff = w;
}

// ---------- Применение команд сервера (Core 1) ----------
// Расход, мс, уже отработанный в скользящем окне DUTY_WINDOW_SEC.
static uint32_t dutyUsedMs(const DutyWindow &w) {
  uint64_t sec = nowMs64() / 1000;
  uint32_t used = 0;
  for (int i = 0; i < DUTY_WINDOW_SEC; i++) {
    if (w.ms[i] > 0 && sec >= w.sec[i] && sec - w.sec[i] < DUTY_WINDOW_SEC) used += w.ms[i];
  }
  return used;
}

static void dutyAccount(DutyWindow &w, uint32_t dtMs) {
  uint64_t sec = nowMs64() / 1000;
  int i = (int)(sec % DUTY_WINDOW_SEC);
  if (w.sec[i] != sec) {
    w.sec[i] = sec;
    w.ms[i] = 0;
  }
  w.ms[i] += dtMs;
}

static uint32_t dutyLeftMs(const DutyWindow &w) {
  uint32_t used = dutyUsedMs(w);
  return used < DUTY_BUDGET_MS ? DUTY_BUDGET_MS - used : 0;
}

static void applyActuators() {
  static uint32_t lastTick = 0;
  ActuatorCommand cmd;
  portENTER_CRITICAL(&g_mux);
  cmd = g_pending;
  g_pending.has = false;
  portEXIT_CRITICAL(&g_mux);

  // Сторож принудительно выключил актуаторы: сбрасываем состояние и возвращаем I2S
  if (g_guardTrip) {
    g_guardTrip = false;
    g_speakerActive = g_buzzerActive = g_vibActive = false;
    g_speakerHz = 0;
    g_hwSpkOn = g_hwBuzOn = g_hwVibOn = false;
    if (g_audioOk) {
      i2s_start(I2S_NUM_0);
      i2s_zero_dma_buffer(I2S_NUM_0);
    }
    Serial.println("[act] guard tripped, actuators reset");
  }

  uint32_t now = millis();
  uint32_t dt = now - lastTick;
  lastTick = now;
  if (dt > 100) dt = 100;

  // Истечение времени (сравнение безопасно при переполнении millis) и лимиты 5 с / 30 с
  if (g_speakerActive) {
    dutyAccount(g_dutySpk, dt);
    if ((int32_t)(g_speakerOffMs - now) <= 0) { g_speakerActive = false; g_speakerHz = 0; }
    else if (dutyUsedMs(g_dutySpk) >= DUTY_BUDGET_MS) {
      g_speakerActive = false;
      g_speakerHz = 0;
      Serial.println("[act] speaker cut by 5 s / 30 s cap");
    }
    if (!g_speakerActive) g_hwSpkOn = false;
  }
  if (g_buzzerActive) {
    dutyAccount(g_dutyBuz, dt);
    if ((int32_t)(g_buzzerOffMs - now) <= 0) g_buzzerActive = false;
    else if (dutyUsedMs(g_dutyBuz) >= DUTY_BUDGET_MS) {
      g_buzzerActive = false;
      Serial.println("[act] buzzer cut by 5 s / 30 s cap");
    }
    if (!g_buzzerActive) g_hwBuzOn = false;
  }
  if (g_vibActive) {
    dutyAccount(g_dutyVib, dt);
    if ((int32_t)(g_vibOffMs - now) <= 0) g_vibActive = false;
    else if (dutyUsedMs(g_dutyVib) >= DUTY_BUDGET_MS) {
      g_vibActive = false;
      Serial.println("[act] vibration cut by 5 s / 30 s cap");
    }
    if (!g_vibActive) g_hwVibOn = false;
  }

  // Одноразовое включение: пока актуатор работает, повторные ответы его не продлевают
  if (cmd.has) {
    if (cmd.speakerMs > 0 && cmd.speakerHz > 0) {
      uint32_t left = dutyLeftMs(g_dutySpk);
      uint32_t ms = min(min((uint32_t)cmd.speakerMs, (uint32_t)SPEAKER_MAX_MS), left);
      if (g_speakerActive || ms < DUTY_MIN_USEFUL_MS) {
        Serial.printf("[cmd] dropped, busy: speaker, %s id %s (%s)\n", cmd.type, cmd.id, g_speakerActive ? "running" : "5 s / 30 s budget used");
      } else {
        g_speakerHz = cmd.speakerHz;
        g_speakerVolume = cmd.speakerVolume > 0 ? cmd.speakerVolume : AUDIO_AMPLITUDE;
        g_speakerOffMs = now + ms;
        g_hwSpkEnd = g_speakerOffMs;
        g_hwSpkOn = true;
        g_speakerActive = true;
        Serial.printf("[act] speaker %u Hz, %lu ms\n", cmd.speakerHz, (unsigned long)ms);
      }
    }
    if (cmd.buzzerMs > 0) {
      uint32_t left = dutyLeftMs(g_dutyBuz);
      uint32_t ms = min(min((uint32_t)cmd.buzzerMs, (uint32_t)BUZZER_MAX_MS), left);
      if (g_buzzerActive || ms < DUTY_MIN_USEFUL_MS) {
        Serial.printf("[cmd] dropped, busy: buzzer, %s id %s (%s)\n", cmd.type, cmd.id, g_buzzerActive ? "running" : "5 s / 30 s budget used");
      } else {
        g_buzzerOffMs = now + ms;
        g_hwBuzEnd = g_buzzerOffMs;
        g_hwBuzOn = true;
        g_buzzerActive = true;
        Serial.printf("[act] buzzer %lu ms\n", (unsigned long)ms);
      }
    }
    if (cmd.vibrateMs > 0) {
      uint32_t left = dutyLeftMs(g_dutyVib);
      uint32_t ms = min((uint32_t)cmd.vibrateMs, left);
      if (g_vibActive || ms < DUTY_MIN_USEFUL_MS) {
        Serial.printf("[cmd] dropped, busy: vibration, %s id %s (%s)\n", cmd.type, cmd.id, g_vibActive ? "running" : "5 s / 30 s budget used");
      } else {
        g_vibOffMs = now + ms;
        g_hwVibEnd = g_vibOffMs;
        g_hwVibOn = true;
        g_vibActive = true;
        Serial.printf("[act] vibration %lu ms (budget left %lu)\n", (unsigned long)ms, (unsigned long)left);
      }
    }
  }

  digitalWrite(PIN_BUZZER, g_buzzerActive ? HIGH : LOW);
  digitalWrite(PIN_VIBRATION, g_vibActive ? HIGH : LOW);
}

// ---------- Сторож актуаторов (отдельная задача, Core 0) ----------
// Не зависит от loop(): если loop() завис или актуатор работает дольше дедлайна, выключает его аппаратно.
static void guardTask(void *) {
  bool wasStale = false;
  for (;;) {
    vTaskDelay(50 / portTICK_PERIOD_MS);
    uint32_t now = millis();
    bool stale = (uint32_t)(now - g_hbMs) > GUARD_STALE_MS;
    bool trip = false;
    if (stale || (g_hwVibOn && (int32_t)(now - g_hwVibEnd) > (int32_t)GUARD_OVERDUE_MS)) {
      digitalWrite(PIN_VIBRATION, LOW);
      trip = trip || g_hwVibOn || stale;
    }
    if (stale || (g_hwBuzOn && (int32_t)(now - g_hwBuzEnd) > (int32_t)GUARD_OVERDUE_MS)) {
      digitalWrite(PIN_BUZZER, LOW);
      trip = trip || g_hwBuzOn || stale;
    }
    if (stale || (g_hwSpkOn && (int32_t)(now - g_hwSpkEnd) > (int32_t)GUARD_OVERDUE_MS)) {
      if (g_audioOk) i2s_stop(I2S_NUM_0);
      trip = trip || g_hwSpkOn || stale;
    }
    if (trip) {
      g_guardTrip = true;
      if (!wasStale) Serial.println("[guard] actuators forced off");
    }
    wasStale = stale;
  }
}

// ---------- Сетевая задача (Core 0) ----------
static bool timeValid() { return time(nullptr) > 1700000000; }

static int g_wifiFailChecks = 0;
static bool g_ntpStarted = false;

static void wifiBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// Wi-Fi: опираемся на автопереподключение; полный disconnect+begin только после 3 подряд неудачных проверок.
static bool wifiEnsure() {
  if (WiFi.status() == WL_CONNECTED) {
    g_wifiFailChecks = 0;
    return true;
  }
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_WAIT_MS) vTaskDelay(250 / portTICK_PERIOD_MS);
  if (WiFi.status() == WL_CONNECTED) {
    g_wifiFailChecks = 0;
    Serial.printf("[wifi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
  }
  g_wifiFailChecks++;
  if (g_wifiFailChecks >= WIFI_FAILS_BEFORE_FULL_RESET) {
    Serial.println("[wifi] 3 failed checks, full reconnect");
    g_wifiFailChecks = 0;
    WiFi.disconnect(true);
    vTaskDelay(100 / portTICK_PERIOD_MS);
    wifiBegin();
  } else {
    Serial.printf("[wifi] not connected (check %d/%d), reconnect()\n", g_wifiFailChecks, WIFI_FAILS_BEFORE_FULL_RESET);
    WiFi.reconnect();
  }
  return false;
}

// NTP не блокирует отправку: SNTP запускается один раз и досинхронизируется в фоне.
static void ntpKick() {
  if (g_ntpStarted) return;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  g_ntpStarted = true;
}

static WiFiClientSecure g_client;
static HTTPClient g_http;
static bool g_httpInited = false;
static const char *g_collectKeys[] = {"Retry-After"};
static char g_lastCmdId[48] = "";
static bool g_firstReplyOk = false;
static int g_errCount = 0;

// Выполняет POST; при сбое на переиспользованном соединении один раз повторяет на новом.
static int httpPost(const String &body, String &payload, String &retryAfterHdr, uint32_t &ms) {
  bool reused = g_http.connected();
  int status = 0;
  for (int attempt = 0; attempt < 2; attempt++) {
    if (!g_http.connected()) {
      g_http.end();
      if (!g_http.begin(g_client, TELEMETRY_URL)) {
        Serial.println("[http] begin failed");
        return -1;
      }
    }
    g_http.addHeader("Content-Type", "application/json");
    g_http.addHeader("X-Device-Code", DEVICE_CODE);
    uint32_t t0 = millis();
    status = g_http.POST(body);
    ms = millis() - t0;
    if (status > 0) break;
    g_http.end();
    g_client.stop();
    bool connErr = status >= -5 && status <= -1;  // refused/send/not connected/lost; таймаут (-11) не повторяем
    if (attempt == 0 && reused && connErr) {
      Serial.printf("[http] reused connection failed (%s), retry on a fresh one\n", HTTPClient::errorToString(status).c_str());
      reused = false;
      continue;
    }
    break;
  }
  if (status > 0) {
    payload = g_http.getString();
    retryAfterHdr = g_http.header("Retry-After");
  }
  return status;
}

static void closeConn() {
  g_http.end();
  g_client.stop();
}

static uint32_t clampU32(long v, long lo, long hi) {
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return (uint32_t)v;
}

static uint32_t backoffSec() {
  int shift = g_errCount > 1 ? g_errCount - 1 : 0;
  if (shift > 5) shift = 5;
  uint32_t s = (uint32_t)BACKOFF_START_SEC << shift;
  return s > BACKOFF_MAX_SEC ? BACKOFF_MAX_SEC : s;
}

// Разбор указаний сервера. Возвращает nextInterval (сек).
static uint32_t handleReply(JsonDocument &res) {
  long ni = res["nextInterval"] | (long)DEFAULT_INTERVAL_SEC;
  uint32_t interval = clampU32(ni, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC);

  ActuatorCommand cmd = {};
  strcpy(cmd.type, "server");

  // 1. Команда тестирования. Один и тот же id не выполняется дважды (сервер может переслать при потере ответа).
  JsonVariantConst cobj = res["command"];
  if (cobj.is<JsonObjectConst>()) {
    const char *ctype = cobj["type"] | "";
    String cid;
    serializeJson(cobj["id"], cid);
    bool known = !strcmp(ctype, "TEST_SPEAKER") || !strcmp(ctype, "TEST_SOUND") || !strcmp(ctype, "TEST_BUZZER") || !strcmp(ctype, "TEST_VIBRATION");
    if (known && cid != "null" && cid == g_lastCmdId) {
      Serial.printf("[cmd] id %s already executed, ignored\n", cid.c_str());
    } else if (known) {
      if (cid != "null") {
        strncpy(g_lastCmdId, cid.c_str(), sizeof g_lastCmdId - 1);
        g_lastCmdId[sizeof g_lastCmdId - 1] = 0;
      }
      Serial.printf("[cmd] %s id %s\n", ctype, cid.c_str());
      cmd.has = true;
      strncpy(cmd.type, ctype, sizeof cmd.type - 1);
      strncpy(cmd.id, cid.c_str(), sizeof cmd.id - 1);
      if (!strcmp(ctype, "TEST_SPEAKER") || !strcmp(ctype, "TEST_SOUND")) {
        cmd.speakerHz = 1200;
        cmd.speakerMs = 800;
        cmd.speakerVolume = AUDIO_AMPLITUDE;
      } else if (!strcmp(ctype, "TEST_BUZZER")) {
        cmd.buzzerMs = 500;
      } else {
        cmd.vibrateMs = 1000;
      }
    }
  }

  // 2. Необязательные прямые параметры. СЕРВЕР ИХ ПОКА НЕ ШЛЁТ (возможно, позже buzzerMs); разбор безвреден.
  int spkMs = res["speakerMs"] | 0;
  int spkHz = res["speakerHz"] | 0;
  int spkVol = res["speakerVolume"] | 0;
  int buzMs = res["buzzerMs"] | 0;
  int vibMs = res["vibrateMs"] | 0;

  if (spkMs > 0 && spkHz > 0) {
    cmd.has = true;
    cmd.speakerHz = constrain(spkHz, 100, 3000);
    cmd.speakerMs = min(spkMs, (int)SPEAKER_MAX_MS);
    if (spkVol > 0) {
      cmd.speakerVolume = (spkVol <= 100) ? (uint16_t)(spkVol * 300) : (uint16_t)constrain(spkVol, 500, 32000);
    } else {
      cmd.speakerVolume = AUDIO_AMPLITUDE;
    }
  }
  if (buzMs > 0) {
    cmd.has = true;
    cmd.buzzerMs = min(buzMs, (int)BUZZER_MAX_MS);
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
    g_pending = cmd;  // armed at most once by Core 1 (см. applyActuators)
    portEXIT_CRITICAL(&g_mux);
  }

  Serial.printf("[http] ok: mode %s, zone %s, next %lu s\n", (const char *)(res["mode"] | "?"), (const char *)(res["zone"] | "?"), (unsigned long)interval);
  return interval;
}

// Одна попытка отправки. Возвращает паузу до следующей (сек).
static uint32_t sendTelemetry() {
  Snapshot s;
  portENTER_CRITICAL(&g_mux);
  s = g_snap;
  portEXIT_CRITICAL(&g_mux);

  bool haveTime = timeValid();
  JsonDocument req;
  req["code"] = DEVICE_CODE;
  if (haveTime) {
    char ts[25];
    time_t now = time(nullptr);
    struct tm tmv;
    gmtime_r(&now, &tmv);
    strftime(ts, sizeof ts, "%Y-%m-%dT%H:%M:%SZ", &tmv);
    req["timestamp"] = ts;
  }
  // Координаты требуют timestamp на сервере: без синхронного времени шлём только пульс (pulse-only).
  if (haveTime && s.haveLast) {
    req["latitude"] = serialized(String(s.lat, 6));
    req["longitude"] = serialized(String(s.lng, 6));
    req["accuracy"] = serialized(String(s.fixValid ? s.accuracy : ACCURACY_NO_FIX_M, 1));
  }
  int rssi = WiFi.RSSI();
  if (rssi < 0 && rssi >= -130) req["signal"] = rssi;
  req["speedKmh"] = serialized(String(constrain(s.fixValid ? s.speedKmh : 0.0, 0.0, 300.0), 1));
  if (s.hdop >= 0 && s.hdop <= 99) req["hdop"] = serialized(String(s.hdop, 1));
  if (s.satellites >= 0 && s.satellites <= 64) req["satellites"] = s.satellites;
  if (s.heartRate > 0) req["heartRate"] = s.heartRate;
  else req["heartRate"] = nullptr;
  String body;
  serializeJson(req, body);
  if (!haveTime) Serial.println("[time] no NTP yet, sending pulse-only body");

  if (!g_httpInited) {
    g_client.setCACert(ROOT_CA_PEM);
    g_http.setReuse(true);
    g_http.setConnectTimeout(HTTP_TIMEOUT_MS);
    g_http.setTimeout(HTTP_TIMEOUT_MS);
    g_http.collectHeaders(g_collectKeys, 1);
    g_httpInited = true;
  }

  String payload, retryHdr;
  uint32_t ms = 0;
  int status = httpPost(body, payload, retryHdr, ms);

  if (status <= 0) {
    Serial.printf("[http] request failed (%lu ms): %s\n", (unsigned long)ms, HTTPClient::errorToString(status).c_str());
    closeConn();
    g_errCount++;
    return backoffSec();
  }

  if (status != 200) {
    Serial.printf("[http] status %d (%lu ms): %s\n", status, (unsigned long)ms, payload.substring(0, 200).c_str());
    closeConn();
    if (status >= 500) {
      g_errCount++;
      return backoffSec();
    }
    if (status == 401 || status == 403) return RETRY_AUTH_SEC;
    if (status == 429) {
      long ra = 0;
      JsonDocument eb;
      if (!deserializeJson(eb, payload)) ra = eb["retryAfterSec"] | 0L;
      if (ra <= 0) ra = retryHdr.toInt();
      if (ra <= 0) ra = 60;
      return clampU32(ra, RETRY_429_MIN_SEC, RETRY_429_MAX_SEC);
    }
    return RETRY_400_SEC;  // 400 и прочие 4xx
  }

  JsonDocument res;
  DeserializationError err = deserializeJson(res, payload);
  if (err || !(res["success"] | false)) {
    Serial.printf("[http] reply invalid or success=false (%s)\n", err ? err.c_str() : "success=false");
    closeConn();
    g_errCount++;
    return backoffSec();
  }
  const char *rcode = res["code"] | "";
  if (strcmp(rcode, DEVICE_CODE) != 0) {
    Serial.printf("[http] reply code mismatch (got \"%s\"), ignored\n", rcode);
    closeConn();
    g_errCount++;
    return backoffSec();
  }

  g_errCount = 0;
  g_firstReplyOk = true;
  uint32_t interval = handleReply(res);
  if (interval > KEEPALIVE_MAX_INTERVAL_SEC) closeConn();  // долгая пауза: соединение не держим
  return interval;
}

static void logHealth() {
  static uint32_t last = 0;
  uint32_t now = millis();
  if (now - last < 60000 && last != 0) return;
  last = now;
  Serial.printf("[sys] free heap %u, max block %u, net stack high-water %u words\n", (unsigned)ESP.getFreeHeap(),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT), (unsigned)uxTaskGetStackHighWaterMark(NULL));
}

static void netTask(void *) {
  vTaskDelay(FIRST_INTERVAL_SEC * 1000 / portTICK_PERIOD_MS);  // 5 с до первой отправки
  wifiBegin();
  for (;;) {
    uint32_t delaySec;
    if (wifiEnsure()) {
      ntpKick();
      delaySec = sendTelemetry();
    } else {
      g_errCount++;
      delaySec = g_firstReplyOk ? backoffSec() : FIRST_INTERVAL_SEC;  // Wi-Fi ещё не поднят: 5 с до первого ответа
    }
    logHealth();
    vTaskDelay(delaySec * 1000 / portTICK_PERIOD_MS);
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
  // Первым делом: актуаторы в LOW до Serial и до проверки DEVICE_CODE (пины при загрузке плавают)
  pinMode(PIN_VIBRATION, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_VIBRATION, LOW);
  digitalWrite(PIN_BUZZER, LOW);

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

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  Wire.begin(PIN_SDA, PIN_SCL);
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeIR(0x24);
    particleSensor.setPulseAmplitudeGreen(0);
    pulseOk = true;
    Serial.println("[pulse] MAX30102 ready");
  } else {
    Serial.println("[pulse] MAX30102 not found, heartRate will be null");
  }

  setupAudio();

  // Сторож актуаторов и сетевая задача на Core 0
  g_hbMs = millis();
  xTaskCreatePinnedToCore(guardTask, "guard", 3072, NULL, 2, NULL, 0);
  xTaskCreatePinnedToCore(netTask, "net", 20480, NULL, 1, NULL, 0);
}

void loop() {
  static uint32_t lastSnap = 0;

  g_hbMs = millis();  // heartbeat для сторожа
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
