/**
 * ============================================================================
 * QAMQOR (ҚАМҚОР) — ESP32 SMART COLLAR FIRMWARE
 * ============================================================================
 * Связка: ESP32 + GPS NEO-6M + Активный/Пассивный Зуммер (Buzzer)
 * 
 * Логика:
 * 1. Считывает GPS-координаты скота в реальном времени.
 * 2. Отправляет телеметрию POST-запросом на сервер: https://qamqor-api.onrender.com/api/v1/device/telemetry
 * 3. Если сервер сообщает inFence == false (выход за пределы пастбища):
 *    -> Зуммер непрерывно пищит (тревога) до тех пор, пока скот не вернется в зону.
 * 4. Как только сервер подтверждает inFence == true:
 *    -> Зуммер немедленно выключается.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>

// ==========================================
// 1. НАСТРОЙКИ WI-FI И СЕРВЕРА
// ==========================================
// Имя и пароль Wi-Fi (можно раздать с мобильного телефона в поле)
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Живой сервер Qamqor на Render
const char* SERVER_URL    = "https://qamqor-api.onrender.com/api/v1/device/telemetry";

// Токен авторизации ошейника (задан в .env бэкенда)
const char* DEVICE_TOKEN  = "qamqor_esp32_device_shared_key_2026";
const char* DEVICE_ID     = "QAM-0001"; // ID ошейника

// ==========================================
// 2. РАСПИНОВКА (ПИНЫ ПОДКЛЮЧЕНИЯ)
// ==========================================
#define GPS_RX_PIN   16    // ESP32 GPIO 16 (RX2) -> подключить к TX GPS модуля
#define GPS_TX_PIN   17    // ESP32 GPIO 17 (TX2) -> подключить к RX GPS модуля
#define GPS_BAUDRATE 9600  // Стандартная скорость NEO-6M / NEO-8M

#define BUZZER_PIN   18    // ESP32 GPIO 18 -> VCC/Signal зуммера
#define BUZZER_IS_PASSIVE false // true, если пассивный пьезодинамик; false, если активный зуммер

// ==========================================
// 3. ГЛОБАЛЬНЫЕ ОБЪЕКТЫ И ПЕРЕМЕННЫЕ
// ==========================================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2); // Используем UART2 (Serial2)

bool isAlarmActive = false;         // Флаг тревоги (пищать ли зуммеру)
unsigned long lastSendTime = 0;     // Время последней отправки
unsigned long sendIntervalMs = 5000;// Интервал отправки координат (5 сек)

// Переменные для прерывистого пищания (500 мс звук / 200 мс пауза)
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;

// ==========================================
// ФУНКЦИЯ УПРАВЛЕНИЯ ЗУММЕРОМ
// ==========================================
void updateBuzzer() {
  if (!isAlarmActive) {
    // Скот внутри зоны -> тишина
    if (BUZZER_IS_PASSIVE) {
      noTone(BUZZER_PIN);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }
    buzzerState = false;
    return;
  }

  // Скот вне зоны -> тревожное прерывистое пищание без остановки!
  unsigned long now = millis();
  unsigned long interval = buzzerState ? 500 : 200; // 500мс гудок, 200мс пауза

  if (now - lastBuzzerToggle >= interval) {
    lastBuzzerToggle = now;
    buzzerState = !buzzerState;

    if (buzzerState) {
      if (BUZZER_IS_PASSIVE) {
        tone(BUZZER_PIN, 2700); // 2.7 кГц резкий громкий тон
      } else {
        digitalWrite(BUZZER_PIN, HIGH);
      }
    } else {
      if (BUZZER_IS_PASSIVE) {
        noTone(BUZZER_PIN);
      } else {
        digitalWrite(BUZZER_PIN, LOW);
      }
    }
  }
}

// ==========================================
// ОТПРАВКА GPS КООРДИНАТ НА СЕРВЕР
// ==========================================
void sendCoordinatesToServer(double lat, double lng, float accuracy) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ Ошибка: Wi-Fi не подключен!");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Пропускаем проверку SSL сертификата Cloudflare/Render
  client.setTimeout(10000);

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("❌ Ошибка инициализации HTTP");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);

  // Формируем JSON
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = "2026-11-03T12:00:00.000Z";
  doc["latitude"] = lat;
  doc["longitude"] = lng;
  doc["accuracy"] = accuracy;
  doc["battery"] = 92;
  doc["signal"] = WiFi.RSSI();

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("\n📡 Отправка данных на сервер...");
  Serial.print("   Payload: ");
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
      bool vibrate = resDoc["vibrate"] | false;
      int nextSec  = resDoc["nextInterval"] | 5;

      // ОБНОВЛЯЕМ РЕЖИМ ТРЕВОГИ:
      if (!inFence || vibrate) {
        Serial.println("🚨 ВНИМАНИЕ: СКОТ ВНЕ ПАСТБИЩА! ВКЛЮЧАЕМ ЗУММЕР!");
        isAlarmActive = true;
        sendIntervalMs = 4000; // Учащаем отправку при тревоге (каждые 4 сек)
      } else {
        Serial.println("✅ Скот внутри пастбища. Зуммер выключен.");
        isAlarmActive = false;
        sendIntervalMs = 8000; // Стандартный опрос раз в 8 сек
      }
    }
  } else {
    Serial.printf("❌ Ошибка HTTP запроса: %d, %s\n", httpCode, http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==========================================");
  Serial.println("🐎 QAMQOR ESP32 SMART COLLAR INITIALIZING");
  Serial.println("==========================================");

  // Настройка пина зуммера
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Тестовый короткий писк при включении
  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);

  // Запуск GPS порта
  gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("🛰️ GPS UART запущен на пинах 16 (RX) / 17 (TX)");

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
    Serial.println("\n✅ Wi-Fi подключен!");
    Serial.print("   IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n⚠️ Не удалось подключиться к Wi-Fi, продолжаю попытки в фоне...");
  }
}

// ==========================================
// LOOP
// ==========================================
void loop() {
  // 1. Постоянно читаем входящий поток от GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. Обновляем звук зуммера (без блокирующих задержек!)
  updateBuzzer();

  // 3. Периодическая отправка координат на сервер
  unsigned long now = millis();
  if (now - lastSendTime >= sendIntervalMs) {
    lastSendTime = now;

    double lat = 0.0;
    double lng = 0.0;
    float accuracy = 5.0;

    if (gps.location.isValid()) {
      lat = gps.location.lat();
      lng = gps.location.lng();
      accuracy = gps.hdop.isValid() ? (gps.hdop.hdop() * 2.0) : 4.0;
      Serial.printf("📍 GPS Fix: Lat=%.6f, Lng=%.6f, Satellites=%d\n", lat, lng, gps.satellites.value());
      sendCoordinatesToServer(lat, lng, accuracy);
    } else {
      Serial.println("⏳ Поиск спутников GPS... (если внутри здания, выйдите к окну)");
      // ДЛЯ ТЕСТА (если нет видимости спутников дома):
      // Раскомментируйте строку ниже, чтобы отправить тестовую точку в степи:
      // sendCoordinatesToServer(43.6501, 51.1572, 3.0); // Внутри зоны
      // sendCoordinatesToServer(43.6890, 51.1890, 3.0); // Снаружи (вызовет писк!)
    }
  }
}
