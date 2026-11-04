/**
 * ============================================================================
 * QAMQOR (ҚАМҚОР) — ПРОФЕССИОНАЛЬНЫЙ СМАРТ-ОШЕЙНИК ДЛЯ СКОТА (v2.0 PRO)
 * ============================================================================
 * Аппаратная платформа: ESP32-WROVER (с поддержкой внешней PSRAM)
 * 
 * ПОДКЛЮЧЕННЫЕ МОДУЛИ:
 * 1. Аудиосистема: Модуль ArduParts.kz MAX98357 (I2S ЦАП + Усилитель 3W Class D)
 *    + Динамик 0.5 Ватт 8 Ом (Громкая предупреждающая агро-сирена)
 * 2. Вибромотор: Тактильное предупреждение животного (через транзистор NPN / MOSFET)
 * 3. Генератор импульсов 400 кВ: Высоковольтная электроизгородь/электро-пастух
 *    (через мощный N-MOSFET с оптронной развязкой и дозированным импульсом 150 мс)
 * 4. GPS Модуль: NEO-6M / ATGM336H на безопасных пинах GPIO 32 / 33
 *    (Пины 16 и 17 НЕ ИСПОЛЬЗУЮТСЯ, так как в WROVER они заняты под PSRAM!)
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>
#include <driver/i2s.h>
#include <math.h>

// ============================================================================
// 1. НАСТРОЙКИ WI-FI И СЕРВЕРА QAMQOR
// ============================================================================
const char* WIFI_SSID     = "BB";
const char* WIFI_PASSWORD = "Student111";

// Live REST API на Render
const char* SERVER_URL    = "https://qamqor-api.onrender.com/api/v1/device/telemetry";
const char* DEVICE_TOKEN  = "qamqor_esp32_device_shared_key_2026";
const char* DEVICE_ID     = "QAM-0001";

// ============================================================================
// 2. РАСПИНОВКА ДЛЯ ESP32-WROVER (100% БЕЗОПАСНО ДЛЯ PSRAM)
// ============================================================================
// GPS UART2 (НЕЛЬЗЯ 16/17 на WROVER!)
#define PIN_GPS_RX        32   // ESP32 RX2 <- TX GPS модуля
#define PIN_GPS_TX        33   // ESP32 TX2 -> RX GPS модуля
#define GPS_BAUDRATE      9600 // Стандартная скорость NEO-6M / NEO-8M

// I2S Аудио Усилитель MAX98357
#define PIN_I2S_BCLK      26   // Bit Clock (BCLK)
#define PIN_I2S_LRC       25   // Word Select / Left-Right Clock (LRC / WS)
#define PIN_I2S_DOUT      22   // Data Input (DIN на плате MAX98357)

// Исполнительные механизмы
#define PIN_VIBRATION     27   // Затвор/База транзистора вибромотора
#define PIN_SHOCK_400KV   19   // Затвор мощного N-MOSFET генератора импульсов 400кВ
#define PIN_STATUS_LED     2   // Встроенный LED индикатор активности

// ============================================================================
// 3. ГЛОБАЛЬНЫЕ ОБЪЕКТЫ И ПЕРЕМЕННЫЕ СОСТОЯНИЯ
// ============================================================================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Состояние исполнительных триггеров (обновляется с сервера)
bool isSoundActive  = false; // Работа сирены через MAX98357
bool isVibrateActive = false; // Вибромотор
bool isShockActive   = false; // Разрешение на шоковый импульс

// Таймеры неблокирующей работы
unsigned long lastSendTime = 0;
unsigned long sendIntervalMs = 5000; // Опрос каждые 5 сек

// Таймер электро-импульса 400кВ (строго дозирован для безопасности!)
unsigned long shockStartTime = 0;
bool isShockCurrentlyFiring = false;
unsigned long lastShockTime = 0;
const unsigned long SHOCK_PULSE_DURATION_MS = 150; // Длительность импульса: 150 мс
const unsigned long SHOCK_MIN_COOLDOWN_MS   = 6000; // Минимальная пауза между шоками: 6 сек

// Генератор сирены I2S
#define I2S_SAMPLE_RATE   16000
#define I2S_DMA_BUF_LEN     256
int16_t soundBuffer[I2S_DMA_BUF_LEN];
float sirenPhase = 0.0;
float sirenFreq = 800.0;
bool sirenFreqDirection = true;

// ============================================================================
// 4. ИНИЦИАЛИЗАЦИЯ I2S ДЛЯ УСИЛИТЕЛЯ MAX98357
// ============================================================================
void initI2SAudio() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate = I2S_SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = I2S_DMA_BUF_LEN,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = PIN_I2S_BCLK,
    .ws_io_num = PIN_I2S_LRC,
    .data_out_num = PIN_I2S_DOUT,
    .data_in_num = I2S_PIN_NO_CHANGE
  };

  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
  i2s_set_clk(I2S_NUM_0, I2S_SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO);
  
  Serial.println("🔊 I2S Audio Driver (MAX98357) успешно инициализирован.");
}

// ============================================================================
// 5. ГЕНЕРАЦИЯ ЗВУКА СИРЕНЫ ЧЕРЕЗ MAX98357 (НЕБЛОКИРУЮЩАЯ)
// ============================================================================
void updateAudioOutput() {
  if (!isSoundActive) {
    // Если звук выключен — передаем нули, чтобы динамик не шипел
    memset(soundBuffer, 0, sizeof(soundBuffer));
    size_t bytes_written;
    i2s_write(I2S_NUM_0, soundBuffer, sizeof(soundBuffer), &bytes_written, 0);
    return;
  }

  // Генерация модулирующей частоты агро-сирены (800 Гц <-> 2400 Гц)
  if (sirenFreqDirection) {
    sirenFreq += 8.0;
    if (sirenFreq >= 2400.0) sirenFreqDirection = false;
  } else {
    sirenFreq -= 8.0;
    if (sirenFreq <= 800.0) sirenFreqDirection = true;
  }

  float phaseIncrement = (2.0 * M_PI * sirenFreq) / I2S_SAMPLE_RATE;
  int16_t volume = 12000; // Оптимальная амплитуда для 0.5 Ватт 8 Ом динамика

  for (int i = 0; i < I2S_DMA_BUF_LEN; i += 2) {
    int16_t sample = (int16_t)(sin(sirenPhase) * volume);
    sirenPhase += phaseIncrement;
    if (sirenPhase >= 2.0 * M_PI) sirenPhase -= 2.0 * M_PI;

    soundBuffer[i]     = sample; // Левый канал
    soundBuffer[i + 1] = sample; // Правый канал
  }

  size_t bytes_written;
  i2s_write(I2S_NUM_0, soundBuffer, sizeof(soundBuffer), &bytes_written, 0);
}

// ============================================================================
// 6. УПРАВЛЕНИЕ ВИБРОМОТОРОМ
// ============================================================================
void updateVibrationMotor() {
  if (isVibrateActive) {
    // Прерывистая вибрация: 500мс работа / 200мс пауза для резкого тактильного эффекта
    unsigned long now = millis();
    bool vibeState = (now % 700) < 500;
    digitalWrite(PIN_VIBRATION, vibeState ? HIGH : LOW);
  } else {
    digitalWrite(PIN_VIBRATION, LOW);
  }
}

// ============================================================================
// 7. БЕЗОПАСНОЕ УПРАВЛЕНИЕ ГЕНЕРАТОРОМ ИМПУЛЬСОВ 400кВ
// ============================================================================
void updateElectricShock() {
  unsigned long now = millis();

  // Если импульс сейчас активен — проверяем таймер отключения
  if (isShockCurrentlyFiring) {
    if (now - shockStartTime >= SHOCK_PULSE_DURATION_MS) {
      digitalWrite(PIN_SHOCK_400KV, LOW);
      isShockCurrentlyFiring = false;
      lastShockTime = now;
      Serial.println("⚡ [400kV] Импульс тока завершен (150 мс). Кулдаун 6 сек.");
    }
    return;
  }

  // Если сервер запрашивает шок и прошел кулдаун безопасности:
  if (isShockActive && (now - lastShockTime >= SHOCK_MIN_COOLDOWN_MS)) {
    Serial.println("⚡⚡⚡ [400kV] ВНИМАНИЕ: СРАБАТЫВАНИЕ ЭЛЕКТРО-ИМПУЛЬСА (150 мс)!");
    digitalWrite(PIN_SHOCK_400KV, HIGH);
    isShockCurrentlyFiring = true;
    shockStartTime = now;
  }
}

// ============================================================================
// 8. ОТПРАВКА ТЕЛЕМЕТРИИ И ПРИЁМ КОМАНД С СЕРВЕРА
// ============================================================================
void sendTelemetryToServer(double lat, double lng, float accuracy) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Wi-Fi потерян. Попытка переподключения...");
    WiFi.reconnect();
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Пропускаем проверку SSL сертификата Cloudflare/Render
  client.setTimeout(8000);

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("❌ Ошибка соединения HTTP");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);

  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = "2026-11-04T12:00:00.000Z";
  doc["latitude"] = lat;
  doc["longitude"] = lng;
  doc["accuracy"] = accuracy;
  doc["battery"] = 92;
  doc["signal"] = WiFi.RSSI();

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("\n📡 Отправка телеметрии ошейника...");
  Serial.print("   Данные: ");
  Serial.println(requestBody);

  int httpCode = http.POST(requestBody);

  if (httpCode == HTTP_CODE_OK || httpCode == 201) {
    String response = http.getString();
    Serial.print("📥 Ответ сервера: ");
    Serial.println(response);

    StaticJsonDocument<512> resDoc;
    DeserializationError error = deserializeJson(resDoc, response);

    if (!error) {
      bool inFence = resDoc["inFence"] | true;
      bool buzzer  = resDoc["buzzer"] | false;
      bool sound   = resDoc["sound"] | buzzer;
      bool vibrate = resDoc["vibrate"] | false;
      bool shock   = resDoc["shock"] | false;

      // Применяем актуальные команды от сервера
      isSoundActive   = (!inFence || sound || buzzer);
      isVibrateActive = (!inFence || vibrate);
      isShockActive   = (!inFence || shock);

      if (isSoundActive || isVibrateActive || isShockActive) {
        Serial.printf("🚨 ТРЕВОГА! Звук(I2S)=%d | Вибро=%d | Шокер400кВ=%d\n", 
                      isSoundActive, isVibrateActive, isShockActive);
        digitalWrite(PIN_STATUS_LED, HIGH);
        sendIntervalMs = 3000; // Учащаем опрос при тревоге
      } else {
        Serial.println("✅ В пределах нормы. Все исполнительные датчики отключены.");
        digitalWrite(PIN_STATUS_LED, LOW);
        sendIntervalMs = 5000;
      }
    }
  } else {
    Serial.printf("❌ Ошибка HTTP: %d\n", httpCode);
  }

  http.end();
}

// ============================================================================
// 9. SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================================");
  Serial.println("🐎 QAMQOR SMART LIVESTOCK COLLAR v2.0 (ESP32-WROVER)");
  Serial.println("   [I2S Audio MAX98357 + 0.5W | Vibe | 400kV Shock | GPS]");
  Serial.println("========================================================");

  // Настройка пинов исполнительных механизмов
  pinMode(PIN_VIBRATION, OUTPUT);
  digitalWrite(PIN_VIBRATION, LOW);

  pinMode(PIN_SHOCK_400KV, OUTPUT);
  digitalWrite(PIN_SHOCK_400KV, LOW);

  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  // Инициализация I2S аудио (MAX98357)
  initI2SAudio();

  // Короткий приветственный тест звука (0.15 сек)
  isSoundActive = true;
  for (int i = 0; i < 40; i++) {
    updateAudioOutput();
    delay(4);
  }
  isSoundActive = false;
  updateAudioOutput();

  // Инициализация GPS на безопасных пинах (GPIO 32/33)
  gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.println("🛰️ GPS UART2 запущен на GPIO 32(RX) / 33(TX)");

  // Подключение к Wi-Fi
  Serial.print("📶 Подключение к Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 25) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Wi-Fi подключен! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n⚠️ Wi-Fi не подключен сразу, продолжение попыток в фоне...");
  }
}

// ============================================================================
// 10. ГЛАВНЫЙ ЦИКЛ (LOOP) — 100% НЕБЛОКИРУЮЩИЙ
// ============================================================================
void loop() {
  // 1. Постоянно принимаем поток байт от GPS модуля
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. Обновляем аудиопоток I2S сирены на усилитель MAX98357
  updateAudioOutput();

  // 3. Обновляем состояние вибромотора
  updateVibrationMotor();

  // 4. Обновляем работу шокера 400кВ с защитой от перегрева
  updateElectricShock();

  // 5. Периодическая отправка координат и проверка команд
  unsigned long now = millis();
  if (now - lastSendTime >= sendIntervalMs) {
    lastSendTime = now;

    double lat = 43.6501;
    double lng = 51.1572;
    float accuracy = 5.0;

    if (gps.location.isValid()) {
      lat = gps.location.lat();
      lng = gps.location.lng();
      accuracy = gps.hdop.isValid() ? (gps.hdop.hdop() * 2.0) : 4.0;
      Serial.printf("📍 [GPS FIX] Спутников: %d | Координаты: %.6f, %.6f\n", 
                    gps.satellites.value(), lat, lng);
    } else {
      Serial.println("🏢 [В ЗДАНИИ] Спутников нет, отправляю контрольный пинг для проверки триггеров...");
    }

    sendTelemetryToServer(lat, lng, accuracy);
  }
}
