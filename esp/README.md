Status: implemented (firmware written; hardware test not run)

# esp — прошивка ошейника

Прошивка ESP32 (Arduino framework, PlatformIO) для умного ошейника: читает GPS, раз в интервал шлёт позицию на сервер по HTTPS и по ответу включает звук и вибрацию. Контракт и решение владельца: [api-contract.md](../docs/architecture/api-contract.md), [device-code-protocol.md](../docs/architecture/device-code-protocol.md).

## Структура

| Файл | Назначение |
|---|---|
| `platformio.ini` | плата `esp32dev`, библиотеки TinyGPSPlus и ArduinoJson |
| `include/config.h` | пины, таймауты, границы интервалов (все допущения тут) |
| `include/secrets.h` | **локальный, в .gitignore**: Wi-Fi и код ошейника |
| `include/secrets.example.h` | шаблон без секретов (можно коммитить) |
| `src/main.cpp` | главный цикл: Wi-Fi, время, GPS, отправка, пауза |
| `src/gps.*` | чтение GPS (TinyGPSPlus), оценка точности |
| `src/net.*` | Wi-Fi, NTP, HTTPS POST, разбор ответа |
| `src/actuators.*` | звук (LEDC) и вибромотор |
| `src/certs.h` | корневой сертификат для проверки TLS |

## Идентичность: 8-значный код

- `DEVICE_CODE` в `secrets.h`: ровно 8 цифр. При старте проверяется; неверный код останавливает прошивку.
- Код уходит в теле (`code`) и заголовке `X-Device-Code`. Пока владелец не «принял» код в кабинете, сервер отвечает `401`.
- Ответ принимается, только если `success == true` и `code` в ответе равен своему коду. Иначе ответ отбрасывается (звук, вибрация и `nextInterval` не применяются, пауза 300 с).
- Сейчас в `secrets.h` стоит заглушка `12345678`: замените на собственные 8 цифр ошейника.

## Подключение (пины приняты по умолчанию, меняются в `include/config.h`)

| Компонент | Вывод модуля | Пин ESP32 | Примечание |
|---|---|---|---|
| GPS (NEO-6M/7M/8M) | TX | GPIO16 (RX2) | UART2, 9600 бод |
| GPS | RX | GPIO17 (TX2) | |
| GPS | VCC / GND | 3V3 (или 5V по модулю) / GND | проверьте питание вашего модуля |
| Зуммер или динамик | сигнал | GPIO25 | пассивный зуммер, тон через LEDC; динамик только через усилитель |
| Вибромотор | база NPN-транзистора через 1 кОм | GPIO26 | мотор между питанием и коллектором, обратный диод параллельно мотору |

Пины GPS и зуммера-вибромотора не подтверждены железом: это допущение, пока нет схемы платы.

## Что делает прошивка

1. Подключается к Wi-Fi (STA) и синхронизирует время по NTP (нужно для TLS и поля `timestamp`).
2. Ждёт GPS-фикс до 15 с. Точность `accuracy` = HDOP × 5 м (допущение).
3. Если фикса нет, но позиция уже была: шлёт последнюю известную позицию с `accuracy` 999 м. Сервер считает зону `UNKNOWN` (исполнительные устройства выключены) и создаёт оповещение `GPS_LOST`. Если позиции не было ни разу, ничего не шлёт (поля координат обязательны) и повторяет через 30 с.
4. `POST https://qamqor-api.onrender.com/api/v1/device/telemetry`, таймаут 30 с (холодный старт Render free).
5. Успех: сначала звуковой сигнал (3 коротких на `toneFrequencyHz`), затем вибрация `vibrateDurationMs` (не дольше 5 с); команды `TEST_SOUND` и `TEST_VIBRATION` тоже выполняются. Следующий пинг через `nextInterval` сервера, ограничено 5…3600 с (по умолчанию 300 с; в зоне побега сервер сокращает интервал, значение по умолчанию на сервере 60 с).
6. Ошибки (исполнительные устройства не включаются): `401` повтор через 300 с; `400` через 60 с; `429` через `retryAfterSec`; `5xx` и сетевые сбои с нарастающей паузой 10, 20, 40 … 300 с.

Лог в Serial (115200) на обычном тексте. Пароль Wi-Fi не печатается (`********`).

## Настройка secrets.h

```
copy include\secrets.example.h include\secrets.h     (Windows)
cp include/secrets.example.h include/secrets.h       (Linux/macOS)
```

Заполните `WIFI_SSID`, `WIFI_PASS`, `DEVICE_CODE`. Файл в `.gitignore`, не коммитьте его и не копируйте пароль в другие файлы. Внимание: `secrets.h` с реальными значениями уже лежит у вас локально, в репозиторий он не попадёт.

## Прошивка: PlatformIO

```
pip install platformio
cd esp
pio run                 # сборка
pio run -t upload       # прошивка (плата по USB)
pio device monitor      # лог, 115200
```

## Прошивка: Arduino IDE

1. Установите поддержку плат ESP32 (Boards Manager, пакет «esp32 by Espressif», версия 2.0.x; код использует API LEDC ядра 2.x).
2. Library Manager: установите `TinyGPSPlus` (Mikal Hart) и `ArduinoJson` (версия 7.x).
3. Создайте папку скетча `qamqor/` и положите в неё: `src/main.cpp` как `qamqor.ino`, а также `src/*.cpp`, `src/*.h`, `include/config.h`, `include/secrets.h` (все в одну папку).
4. Плата: «ESP32 Dev Module», выберите порт, Upload; Serial Monitor 115200.

## Корневой сертификат (TLS)

Сервер проверяется по корневому сертификату в `src/certs.h`. Цепочка `qamqor-api.onrender.com` (проверено 2026-11-09 командой `openssl s_client`): `onrender.com` ← Google Trust Services `WE1` ← **GTS Root R4** (самоподписанный, действует до **2036-06-22**). Проверка только по этому корню прошла (`openssl s_client -CAfile`, код 0).

Если связь падает с ошибкой сертификата (Render сменил цепочку):

```
openssl s_client -connect qamqor-api.onrender.com:443 -servername qamqor-api.onrender.com -showcerts
```

Возьмите самоподписанный корень, под которым стоит цепочка (его можно скачать у издателя ЦС), и замените PEM в `src/certs.h`. Отключать проверку сертификата нельзя.

## Что не проверено

- Работа на реальной плате с GPS, зуммером и мотором.
- Реальный обмен с сервером (код должен быть принят владельцем в кабинете).
- Пины и схема питания приняты как допущение.

## Известный риск

8-значный код не секрет: тот, кто знает принятый код, может отправлять ложные позиции этого ошейника. Перебор замедлен лимитом запросов (10^8 вариантов). Усиление позже без поломки прошивок: необязательный секрет или HMAC тела.

### If the Windows user folder has Cyrillic in its name

PlatformIO does not build from a path with non-Latin letters ("Arduino.h not found"). Point its folder at a Latin path:

```bash
set PLATFORMIO_CORE_DIR=C:\pio_core
pio run -t upload
```
