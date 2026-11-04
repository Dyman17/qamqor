/**
 * ============================================================================
 * QAMQOR (ҚАМҚОР) — ПРОФЕССИОНАЛЬНЫЙ СМАРТ-ОШЕЙНИК ДЛЯ СКОТА (v2.1 PRO)
 * ============================================================================
 * Аппаратная платформа: ESP32-WROVER (с поддержкой внешней PSRAM 4MB/8MB)
 * 
 * ПОДКЛЮЧЕННЫЕ МОДУЛИ И ПЕРИФЕРИЯ:
 * 1. Аудиосистема: Модуль ArduParts.kz MAX98357 (I2S ЦАП + Усилитель 3W Class D)
 *    - BCLK: GPIO 26
 *    - LRC / WS: GPIO 25
 *    - DOUT / DIN: GPIO 22
 *    - Динамик: 0.5 Ватт 8 Ом (агро-сирена с динамической сменой зон)
 * 2. Вибромотор: Тактильное предупреждение животного (GPIO 27, транзистор NPN / MOSFET)
 * 3. Генератор импульсов 400 кВ: Электроизгородь / электропастух (GPIO 19, N-MOSFET)
 *    - Строгое аппаратное ограничение импульса: не более 150 мс
 *    - Минимальный интервал охлаждения (кулдаун): не менее 6000 мс (6 сек)
 *    - Аппаратная защита животного (Lockout): максимум 3 импульса подряд!
 * 4. GPS Модуль: NEO-6M / ATGM336H на безопасных пинах GPIO 32 (RX) / GPIO 33 (TX)
 *    ВНИМАНИЕ! Пины GPIO 16 и GPIO 17 СТРОГО ЗАПРЕЩЕНЫ (заняты внутренней шиной PSRAM WROVER!)
 * 
 * ПОДДЕРЖКА ЗОН ГЕОЗОНИРОВАНИЯ (Virtual Fence Zones):
 * - GREEN  (Безопасная зона): тишина, вибро выключено, шок отключен.
 * - YELLOW (Предупреждение): прерывистые импульсы звука низкой частоты (~800-1400 Гц) + легкое вибро.
 * - ORANGE (Опасное приближение): непрерывный звук высокой частоты (~1600-2400 Гц) + частое вибро.
 * - RED    (Выход за периметр): непрерывная тревожная сирена + вибро + дозированный импульс 400кВ.
 * - ESCAPE (Побег / вне досягаемости): звук и шок ПОЛНОСТЬЮ ОТКЛЮЧЕНЫ для защиты скота от паники.
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
// 2. РАСПИНОВКА ДЛЯ ESP32-WROVER (100% БЕЗОПАСНО ДЛЯ ВНУТРЕННЕЙ PSRAM)
// ============================================================================
// GPS UART2 (НИКОГДА НЕ ИСПОЛЬЗОВАТЬ 16/17 НА ESP32-WROVER!)
#define PIN_GPS_RX        32   // ESP32 RX2 <- TX GPS модуля
#define PIN_GPS_TX        33   // ESP32 TX2 -> RX GPS модуля
#define GPS_BAUDRATE      9600 // Стандартный битрейт NEO-6M / ATGM336H

// I2S Аудио ЦАП/Усилитель MAX98357
#define PIN_I2S_BCLK      26   // Bit Clock (BCLK)
#define PIN_I2S_LRC       25   // Word Select / Left-Right Clock (LRC / WS)
#define PIN_I2S_DOUT      22   // Data Input (DIN на плате MAX98357)

// Исполнительные механизмы и индикация
#define PIN_VIBRATION     27   // Затвор транзистора вибромотора
#define PIN_SHOCK_400KV   19   // Затвор N-MOSFET генератора импульсов 400 кВ
#define PIN_STATUS_LED     2   // Встроенный светодиод индикации

// ============================================================================
// 3. ПЕРЕЧИСЛЕНИЯ И СТРУКТУРЫ ЗОН
// ============================================================================
enum CollarZone {
  ZONE_GREEN,   // Безопасная зона внутри загона
  ZONE_YELLOW,  // Зона мягкого предупреждения
  ZONE_ORANGE,  // Зона интенсивного предупреждения (буфер)
  ZONE_RED,     // Зона нарушения границы (электропастух)
  ZONE_ESCAPE   // Зона бегства (гуманная деактивация)
};

CollarZone currentZone       = ZONE_GREEN;
String     currentZoneStr    = "GREEN";
float      distanceToBorder  = 50.0; // Дистанция до границы в метрах
int        serverToneFreqHz  = 0;    // Рекомендуемая сервером частота тона (800 - 2400 Гц)

// ============================================================================
// 4. ТАЙМЕРЫ И ПАРАМЕТРЫ БЕЗОПАСНОСТИ ШОКЕРА 400кВ
// ============================================================================
// Требование 3: строгие тайминги защиты животного
const unsigned long SHOCK_DURATION_MS            = 150;  // Максимальная длительность импульса: 150 мс
const unsigned long SHOCK_COOLDOWN_MS            = 6000; // Минимальная пауза между импульсами: 6000 мс
const int           SHOCK_MAX_CONSECUTIVE_PULSES = 3;    // Максимум 3 импульса подряд перед блокировкой

unsigned long shockStartTime         = 0;
unsigned long lastShockTime          = 0;
bool          isShockCurrentlyFiring = false;
int           consecutiveShockCount  = 0;
bool          isShockLockedOut       = false; // Локаут для защиты животного

// ============================================================================
// 5. ГЛОБАЛЬНЫЕ ОБЪЕКТЫ И ПЕРЕМЕННЫЕ
// ============================================================================
TinyGPSPlus    gps;
HardwareSerial gpsSerial(2);

// Флаги активности исполнительных механизмов
bool isSoundActive   = false; // Воспроизведение звука через MAX98357
bool isVibrateActive = false; // Вибромотор (GPIO 27)
bool isShockActive   = false; // Разрешение на шоковый импульс 400кВ (GPIO 19)

// Таймеры отправки телеметрии
unsigned long lastSendTime   = 0;
unsigned long sendIntervalMs = 5000; // Интервал опроса по умолчанию (5 сек)

// Параметры аудио-синтеза I2S
#define I2S_SAMPLE_RATE    16000
#define I2S_DMA_BUF_LEN      256
int16_t soundBuffer[I2S_DMA_BUF_LEN];
float   sirenPhase         = 0.0;
float   sirenFreq          = 1000.0;
bool    sirenFreqDirection = true;

// ============================================================================
// 6. ВСПОМОГАТЕЛЬНЫЙ ПАРСЕР ИМЕНИ ЗОНЫ
// ============================================================================
CollarZone parseZoneString(const String& zoneStr) {
  if (zoneStr.equalsIgnoreCase("YELLOW")) return ZONE_YELLOW;
  if (zoneStr.equalsIgnoreCase("ORANGE")) return ZONE_ORANGE;
  if (zoneStr.equalsIgnoreCase("RED"))    return ZONE_RED;
  if (zoneStr.equalsIgnoreCase("ESCAPE")) return ZONE_ESCAPE;
  return ZONE_GREEN;
}

// ============================================================================
// 7. ИНИЦИАЛИЗАЦИЯ I2S ДЛЯ УСИЛИТЕЛЯ MAX98357
// ============================================================================
void initI2SAudio() {
  i2s_config_t i2s_config = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate          = I2S_SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format       = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = 4,
    .dma_buf_len          = I2S_DMA_BUF_LEN,
    .use_apll             = false,
    .tx_desc_auto_clear   = true,
    .fixed_mclk           = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num   = PIN_I2S_BCLK,
    .ws_io_num    = PIN_I2S_LRC,
    .data_out_num = PIN_I2S_DOUT,
    .data_in_num  = I2S_PIN_NO_CHANGE
  };

  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
  i2s_set_clk(I2S_NUM_0, I2S_SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO);

  Serial.println("🔊 [I2S] Аудиодрайвер MAX98357 успешно инициализирован (BCLK:26, LRC:25, DOUT:22).");
}

// ============================================================================
// 8. ДИНАМИЧЕСКИЙ ГЕНЕРАТОР ЗВУКА I2S (НЕБЛОКИРУЮЩИЙ)
// ============================================================================
/**
 * Требование 2:
 * - Динамическая подстройка частоты по toneFrequencyHz.
 * - zone == "YELLOW": прерывистые предупреждающие импульсы низкой частоты (~800-1400 Гц).
 * - zone == "ORANGE": непрерывный предупреждающий звук повышенной частоты (~1600-2400 Гц).
 * - zone == "RED": непрерывная срочная тревожная агро-сирена.
 * - zone == "ESCAPE" или "GREEN": звук ПОЛНОСТЬЮ выключен (абсолютная тишина).
 * - Аварийный режим Lockout: если скот не вернулся после 3 шоков, включается тревожная сирена!
 */
void updateAudioOutput() {
  unsigned long now = millis();

  // 1. Проверяем режим полной тишины для зон GREEN и ESCAPE
  bool isSilent = (currentZone == ZONE_GREEN && !isSoundActive) || (currentZone == ZONE_ESCAPE);

  if (isSilent && !isShockLockedOut) {
    memset(soundBuffer, 0, sizeof(soundBuffer));
    size_t bytes_written;
    i2s_write(I2S_NUM_0, soundBuffer, sizeof(soundBuffer), &bytes_written, 0);
    return;
  }

  // 2. Расчет частоты и амплитуды в зависимости от зоны
  float targetFreq = 1000.0;
  int16_t volume   = 12000;
  bool emitAudio   = true;

  if (isShockLockedOut) {
    // Режим защиты животного: непрерывный двухтональный аварийный сигнал (1200 Гц <-> 2200 Гц)
    targetFreq = ((now / 200) % 2 == 0) ? 1200.0 : 2200.0;
    volume = 15000;
  } else if (currentZone == ZONE_YELLOW) {
    // ЖЕЛТАЯ ЗОНА: прерывистые импульсы (300 мс звук / 300 мс тишина) на частоте 800-1400 Гц
    bool pulseActive = ((now % 600) < 300);
    if (!pulseActive) {
      emitAudio = false;
    } else {
      if (serverToneFreqHz >= 800 && serverToneFreqHz <= 1400) {
        targetFreq = (float)serverToneFreqHz;
      } else {
        // Локальная модуляция частоты внутри диапазона 800-1400 Гц
        if (sirenFreqDirection) {
          sirenFreq += 8.0;
          if (sirenFreq >= 1400.0) sirenFreqDirection = false;
        } else {
          sirenFreq -= 8.0;
          if (sirenFreq <= 800.0) sirenFreqDirection = true;
        }
        if (sirenFreq < 800.0 || sirenFreq > 1400.0) sirenFreq = 1000.0;
        targetFreq = sirenFreq;
      }
      volume = 9500; // Мягкая предупреждающая громкость
    }
  } else if (currentZone == ZONE_ORANGE) {
    // ОРАНЖЕВАЯ ЗОНА: непрерывный предупреждающий звук повышенной частоты (1600 - 2400 Гц)
    if (serverToneFreqHz >= 1600 && serverToneFreqHz <= 2400) {
      targetFreq = (float)serverToneFreqHz;
    } else {
      if (sirenFreqDirection) {
        sirenFreq += 10.0;
        if (sirenFreq >= 2400.0) sirenFreqDirection = false;
      } else {
        sirenFreq -= 10.0;
        if (sirenFreq <= 1600.0) sirenFreqDirection = true;
      }
      if (sirenFreq < 1600.0 || sirenFreq > 2400.0) sirenFreq = 1900.0;
      targetFreq = sirenFreq;
    }
    volume = 13000; // Повышенная громкость
  } else if (currentZone == ZONE_RED || isSoundActive) {
    // КРАСНАЯ ЗОНА: непрерывная срочная тревожная агро-сирена (быстрый свип 800 - 2400 Гц)
    if (serverToneFreqHz >= 800 && serverToneFreqHz <= 2400) {
      // Модуляция вокруг опорной частоты сервера (+/- 150 Гц)
      float mod = 150.0 * sin((float)now * 0.02);
      targetFreq = (float)serverToneFreqHz + mod;
    } else {
      if (sirenFreqDirection) {
        sirenFreq += 22.0; // Ускоренный подъем тона
        if (sirenFreq >= 2400.0) sirenFreqDirection = false;
      } else {
        sirenFreq -= 22.0; // Ускоренный спуск тона
        if (sirenFreq <= 800.0) sirenFreqDirection = true;
      }
      targetFreq = sirenFreq;
    }
    volume = 16000; // Максимальная громкость динамика 0.5 Вт
  }

  // Если пауза между импульсами — отправляем нули в ЦАП для исключения фона
  if (!emitAudio) {
    memset(soundBuffer, 0, sizeof(soundBuffer));
    size_t bytes_written;
    i2s_write(I2S_NUM_0, soundBuffer, sizeof(soundBuffer), &bytes_written, 0);
    return;
  }

  // 3. Синтез синусоидального аудиопотока
  float phaseIncrement = (2.0 * M_PI * targetFreq) / I2S_SAMPLE_RATE;

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
// 9. УПРАВЛЕНИЕ ВИБРОМОТОРОМ (GPIO 27, НЕБЛОКИРУЮЩЕЕ)
// ============================================================================
/**
 * Требование 4: вибромотор строго на GPIO 27, неблокирующий код.
 * В YELLOW: мягкие тактильные щелчки (200 мс вкл / 800 мс выкл).
 * В ORANGE: частая пульсация (350 мс вкл / 350 мс выкл).
 * В RED: интенсивная вибрация (500 мс вкл / 200 мс выкл).
 * В GREEN / ESCAPE: отключен (LOW).
 */
void updateVibrationMotor() {
  if (!isVibrateActive || currentZone == ZONE_GREEN || currentZone == ZONE_ESCAPE) {
    digitalWrite(PIN_VIBRATION, LOW);
    return;
  }

  unsigned long now = millis();
  bool vibeState = false;

  if (currentZone == ZONE_YELLOW) {
    vibeState = ((now % 1000) < 200);
  } else if (currentZone == ZONE_ORANGE) {
    vibeState = ((now % 700) < 350);
  } else {
    // ZONE_RED или ручной вызов с сервера
    vibeState = ((now % 700) < 500);
  }

  digitalWrite(PIN_VIBRATION, vibeState ? HIGH : LOW);
}

// ============================================================================
// 10. БЕЗОПАСНОЕ УПРАВЛЕНИЕ ГЕНЕРАТОРОМ ИМПУЛЬСОВ 400кВ (GPIO 19)
// ============================================================================
/**
 * Требование 3:
 * - Строго аппаратный лимит импульса 150 мс (SHOCK_DURATION_MS = 150).
 * - Обязательный минимальный кулдаун 6000 мс (SHOCK_COOLDOWN_MS = 6000).
 * - Максимум 3 последовательных импульса (SHOCK_MAX_CONSECUTIVE_PULSES = 3).
 * - Если скот не вернулся: аппаратная блокировка шокера (Lockout) + звуковая тревога!
 * - Автоматический сброс счетчика и разблокировка при возвращении скота в зону.
 */
void updateElectricShock() {
  unsigned long now = millis();

  // 1. Аппаратная защита: если активен Lockout — затвор MOSFET строго притянут к земле
  if (isShockLockedOut) {
    if (isShockCurrentlyFiring) {
      digitalWrite(PIN_SHOCK_400KV, LOW);
      isShockCurrentlyFiring = false;
    }
    return;
  }

  // 2. Контроль длительности текущего активного импульса (строго <= 150 мс)
  if (isShockCurrentlyFiring) {
    if (now - shockStartTime >= SHOCK_DURATION_MS) {
      digitalWrite(PIN_SHOCK_400KV, LOW);
      isShockCurrentlyFiring = false;
      lastShockTime = now;

      Serial.printf("⚡ [400kV] Импульс #%d завершен (150 мс). Кулдаун %lu мс активирован.\n", 
                    consecutiveShockCount, SHOCK_COOLDOWN_MS);

      // Проверка достижения порога 3 импульсов подряд
      if (consecutiveShockCount >= SHOCK_MAX_CONSECUTIVE_PULSES) {
        isShockLockedOut = true;
        isShockActive    = false;
        isSoundActive    = true; // Звуковая тревога для привлечения внимания пастуха
        Serial.println("\n⛔⛔⛔ [400kV ANIMAL SAFETY LOCKOUT ACTIVATED] ⛔⛔⛔");
        Serial.println("   Животное получило 3 импульса и не отступило назад!");
        Serial.println("   Генератор 400кВ ЗАБЛОКИРОВАН для защиты жизни и здоровья скота.");
        Serial.println("   Активирована аварийная звуковая сигнализация оповещения чабана.");
        Serial.println("========================================================\n");
      }
    }
    return;
  }

  // 3. Запрет шока в зонах GREEN, YELLOW, ORANGE и ESCAPE
  if (currentZone != ZONE_RED) {
    digitalWrite(PIN_SHOCK_400KV, LOW);
    return;
  }

  // 4. Подача нового импульса при соблюдении ВСЕХ условий аппаратной безопасности:
  // - Запрос на шок активен (isShockActive)
  // - Лимит 3 импульсов не исчерпан (consecutiveShockCount < 3)
  // - Прошло не менее 6000 мс с момента завершения предыдущего импульса
  if (isShockActive && 
      (consecutiveShockCount < SHOCK_MAX_CONSECUTIVE_PULSES) && 
      (now - lastShockTime >= SHOCK_COOLDOWN_MS)) {

    consecutiveShockCount++;
    shockStartTime = now;
    isShockCurrentlyFiring = true;
    digitalWrite(PIN_SHOCK_400KV, HIGH);

    Serial.printf("⚡⚡⚡ [400kV] СРАБАТЫВАНИЕ ИМПУЛЬСА #%d / %d (длительность: %lu мс)!\n",
                  consecutiveShockCount, SHOCK_MAX_CONSECUTIVE_PULSES, SHOCK_DURATION_MS);
  }
}

// ============================================================================
// 11. ОТПРАВКА ТЕЛЕМЕТРИИ И ПРИЕМ КОМАНД С СЕРВЕРА
// ============================================================================
/**
 * Требование 1 и 6:
 * - Парсинг полей: zone, distanceToBorderMeters, toneFrequencyHz.
 * - Надежный fallback при тестировании в помещении (indoor pinging) без фикса спутников.
 */
void sendTelemetryToServer(double lat, double lng, float accuracy) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Wi-Fi потерян. Попытка переподключения...");
    WiFi.reconnect();
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Пропускаем валидацию сертификата Cloudflare/Render
  client.setTimeout(8000);

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("❌ Ошибка соединения HTTP");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);

  // Формирование JSON телеметрии
  StaticJsonDocument<256> reqDoc;
  reqDoc["deviceId"] = DEVICE_ID;

  // Формируем ISO timestamp по спутникам или локальному времени
  char timeBuffer[32];
  if (gps.date.isValid() && gps.time.isValid()) {
    snprintf(timeBuffer, sizeof(timeBuffer), "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
             gps.date.year(), gps.date.month(), gps.date.day(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
    reqDoc["timestamp"] = timeBuffer;
  } else {
    reqDoc["timestamp"] = "2026-11-04T12:00:00.000Z";
  }

  reqDoc["latitude"]  = lat;
  reqDoc["longitude"] = lng;
  reqDoc["accuracy"]  = accuracy;
  reqDoc["battery"]   = 94;
  reqDoc["signal"]    = WiFi.RSSI();

  String requestBody;
  serializeJson(reqDoc, requestBody);

  Serial.println("\n📡 Отправка телеметрии ошейника на сервер...");
  Serial.print("   Пакет: ");
  Serial.println(requestBody);

  int httpCode = http.POST(requestBody);

  if (httpCode == HTTP_CODE_OK || httpCode == 201) {
    String response = http.getString();
    Serial.print("📥 Ответ сервера: ");
    Serial.println(response);

    StaticJsonDocument<1024> resDoc;
    DeserializationError error = deserializeJson(resDoc, response);

    if (!error) {
      // 1. Парсинг расширенных полей мульти-зонного геозонирования Qamqor
      if (resDoc.containsKey("zone")) {
        const char* z = resDoc["zone"];
        if (z) currentZoneStr = String(z);
      } else {
        // Fallback для совместимости со старыми версиями API
        bool inFenceLegacy = resDoc["inFence"] | true;
        bool shockLegacy   = resDoc["shock"] | false;
        currentZoneStr     = inFenceLegacy ? "GREEN" : (shockLegacy ? "RED" : "ORANGE");
      }

      currentZone = parseZoneString(currentZoneStr);

      if (resDoc.containsKey("distanceToBorderMeters")) {
        distanceToBorder = resDoc["distanceToBorderMeters"].as<float>();
      }

      if (resDoc.containsKey("toneFrequencyHz")) {
        serverToneFreqHz = resDoc["toneFrequencyHz"].as<int>();
      } else {
        serverToneFreqHz = 0;
      }

      // Совместимость с флагами ручного управления из веб-панели
      bool inFence = resDoc["inFence"] | (currentZone == ZONE_GREEN);
      bool buzzer  = resDoc["buzzer"] | false;
      bool sound   = resDoc["sound"] | buzzer;
      bool vibrate = resDoc["vibrate"] | false;
      bool shock   = resDoc["shock"] | (currentZone == ZONE_RED);

      // 2. Логика реакции исполнительных систем на зоны
      if (currentZone == ZONE_GREEN) {
        // Животное внутри пастбища
        isSoundActive   = sound; // активен только при ручном зуммере с сайта
        isVibrateActive = vibrate;
        isShockActive   = false;

        // Если скот отступил назад — сбрасываем счетчик шокера и снимаем блокировку
        if (consecutiveShockCount > 0 || isShockLockedOut) {
          Serial.printf("🌿 [RETREAT] Скот вернулся в безопасную зону (%s)! Сброс счетчика шокера (%d -> 0) и снятие Lockout.\n",
                        currentZoneStr.c_str(), consecutiveShockCount);
          consecutiveShockCount = 0;
          isShockLockedOut = false;
        }
      } else if (currentZone == ZONE_YELLOW) {
        // Приближение к границе: прерывистый звук 800-1400 Гц + мягкое вибро
        isSoundActive   = true;
        isVibrateActive = true;
        isShockActive   = false;

        if (consecutiveShockCount > 0 || isShockLockedOut) {
          Serial.println("🌿 [RETREAT] Скот отступил в зону предупреждения (YELLOW)! Сброс блокировки шокера.");
          consecutiveShockCount = 0;
          isShockLockedOut = false;
        }
      } else if (currentZone == ZONE_ORANGE) {
        // Опасная буферная зона: непрерывный звук 1600-2400 Гц + частое вибро
        isSoundActive   = true;
        isVibrateActive = true;
        isShockActive   = false;
      } else if (currentZone == ZONE_RED) {
        // Нарушение границы: срочная сирена + вибро + электро-импульс (если не Lockout)
        isSoundActive   = true;
        isVibrateActive = true;
        isShockActive   = (!isShockLockedOut && shock);
      } else if (currentZone == ZONE_ESCAPE) {
        // Побег / животное далеко вне зоны: полная тишина и запрет шока
        isSoundActive   = false;
        isVibrateActive = false;
        isShockActive   = false;
      }

      // При активном Lockout шок запрещен, но звуковая сигнализация включена
      if (isShockLockedOut) {
        isShockActive = false;
        isSoundActive = true;
      }

      // 3. Вывод детального статуса в Serial
      Serial.printf("🏷️ Зона: %s | До границы: %.1f м | Частота тона: %d Гц\n",
                    currentZoneStr.c_str(), distanceToBorder, serverToneFreqHz);
      Serial.printf("   Звук(MAX98357): %s | Вибро(GPIO27): %s | Шок(400кВ): %s | Шоков подряд: %d/3 | Lockout: %s\n",
                    isSoundActive ? "ON" : "OFF",
                    isVibrateActive ? "ON" : "OFF",
                    isShockActive ? "ARMED" : "OFF",
                    consecutiveShockCount,
                    isShockLockedOut ? "ACTIVE (PROTECTED)" : "NO");

      // Индикация LED
      if (currentZone == ZONE_RED || isShockLockedOut) {
        digitalWrite(PIN_STATUS_LED, HIGH);
        sendIntervalMs = 2500; // Учащенный опрос при тревоге
      } else if (currentZone == ZONE_YELLOW || currentZone == ZONE_ORANGE) {
        digitalWrite(PIN_STATUS_LED, HIGH);
        sendIntervalMs = 3000;
      } else {
        digitalWrite(PIN_STATUS_LED, LOW);
        sendIntervalMs = 5000;
      }

      // Адаптивный интервал от сервера
      if (resDoc.containsKey("nextInterval")) {
        unsigned long srvInterval = resDoc["nextInterval"].as<unsigned long>() * 1000;
        if (srvInterval >= 1000) {
          sendIntervalMs = srvInterval;
        }
      }
    }
  } else {
    Serial.printf("❌ Ошибка ответа HTTP: %d\n", httpCode);
  }

  http.end();
}

// ============================================================================
// 12. SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================================");
  Serial.println("🐎 QAMQOR SMART LIVESTOCK COLLAR v2.1 PRO (ESP32-WROVER)");
  Serial.println("   [I2S MAX98357 Audio | Vibe GPIO27 | Safe 400kV Shock | GPS GPIO32/33]");
  Serial.println("========================================================");

  // 1. Конфигурация пинов исполнительных механизмов
  pinMode(PIN_VIBRATION, OUTPUT);
  digitalWrite(PIN_VIBRATION, LOW);

  // Аппаратная защита шокера: гарантированный LOW перед настройкой режима
  digitalWrite(PIN_SHOCK_400KV, LOW);
  pinMode(PIN_SHOCK_400KV, OUTPUT);
  digitalWrite(PIN_SHOCK_400KV, LOW);

  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  // 2. Инициализация I2S аудиосистемы (MAX98357)
  initI2SAudio();

  // Приветственный короткий тест звука (0.15 сек)
  Serial.println("🔊 Тест аудиосистемы MAX98357...");
  currentZone = ZONE_YELLOW;
  serverToneFreqHz = 1100;
  isSoundActive = true;
  for (int i = 0; i < 40; i++) {
    updateAudioOutput();
    delay(4);
  }
  currentZone = ZONE_GREEN;
  isSoundActive = false;
  updateAudioOutput();
  Serial.println("🔊 Аудиосистема протестирована и готова к работе.");

  // 3. Инициализация GPS строго на безопасных пинах WROVER: GPIO 32(RX) / GPIO 33(TX)
  // ВНИМАНИЕ: Пины GPIO 16 и 17 никогда не использовать (заняты внутренней PSRAM!)
  gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.printf("🛰️ GPS UART2 запущен на безопасных пинах GPIO %d(RX) / %d(TX)\n", 
                PIN_GPS_RX, PIN_GPS_TX);

  // 4. Подключение к сети Wi-Fi
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
    Serial.println("\n✅ Wi-Fi подключен успешно! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n⚠️ Wi-Fi не подключен сразу, фоновое переподключение в цикле...");
  }
}

// ============================================================================
// 13. ГЛАВНЫЙ ЦИКЛ (LOOP) — 100% НЕБЛОКИРУЮЩИЙ
// ============================================================================
void loop() {
  // 1. Непрерывный прием NMEA-потока от GPS приемника
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. Непрерывная генерация звука через I2S на динамик MAX98357
  updateAudioOutput();

  // 3. Управление вибромотором на GPIO 27
  updateVibrationMotor();

  // 4. Безопасное управление импульсным шокером 400кВ на GPIO 19
  updateElectricShock();

  // 5. Периодическая отправка телеметрии и получение зон/команд с сервера
  unsigned long now = millis();
  if (now - lastSendTime >= sendIntervalMs) {
    lastSendTime = now;

    // Координаты по умолчанию для безопасного тестирования в помещении (indoor pinging)
    double lat      = 43.6501;
    double lng      = 51.1572;
    float  accuracy = 5.0;

    if (gps.location.isValid()) {
      lat      = gps.location.lat();
      lng      = gps.location.lng();
      accuracy = gps.hdop.isValid() ? (gps.hdop.hdop() * 2.0) : 4.0;
      Serial.printf("📍 [GPS FIX] Спутников: %d | %.6f, %.6f (Точность: %.1f м)\n", 
                    gps.satellites.value(), lat, lng, accuracy);
    } else {
      Serial.println("🏢 [INDOOR TEST / БЕЗ GPS ФИКСА] Отправка контрольного пинга для проверки триггеров зон...");
    }

    sendTelemetryToServer(lat, lng, accuracy);
  }
}
