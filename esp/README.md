Status: implemented (compiles; hardware and live server not tested)

# esp — прошивка ошейника

Один файл для прошивки: [`qamqor_collar/qamqor_collar.ino`](qamqor_collar/qamqor_collar.ino) (Arduino IDE; тот же файл собирается PlatformIO через `src_dir` в `platformio.ini`). Контракт: [api-contract.md](../docs/architecture/api-contract.md), [device-code-protocol.md](../docs/architecture/device-code-protocol.md).

## Настройка (верх файла `.ino`)

```
#define WIFI_SSID "YOUR_WIFI"
#define WIFI_PASS "YOUR_PASSWORD"
#define DEVICE_CODE "12345678"   // 8 цифр этого ошейника
```

В репозитории лежат заглушки. Рабочая копия с реальным Wi-Fi для владельца: `esp/local/qamqor_collar/qamqor_collar.ino` (папка `esp/local/` в `.gitignore`, не коммитится). После изменений основного файла копию нужно пересоздать (заменить две строки Wi-Fi). Пароль в лог не печатается (`********`). `DEVICE_CODE`: ровно 8 цифр, проверяется при старте; тот же код владелец «принимает» в кабинете.

## Подключение (реальное железо владельца)

| Компонент | Вывод | Пин ESP32 |
|---|---|---|
| Вибромотор (модуль) | сигнал | GPIO18 (HIGH = вкл) |
| Активный зуммер (модуль) | сигнал | GPIO19 (HIGH = вкл, без тона) |
| GPS NEO-6M | TX модуля -> RX | GPIO16 (UART2 RX), 9600 бод |
| GPS NEO-6M | RX модуля <- TX | GPIO17 (UART2 TX) |
| Пульс MAX30102 | SDA / SCL | GPIO21 / GPIO22 |
| Динамик MAX98357A | BCLK / LRC / DIN | GPIO26 / GPIO25 / GPIO27 |

I2S: 16 кГц, 16 бит, моно (левый канал), «старый» драйвер `driver/i2s.h`.

## Прошивка: Arduino IDE

1. Boards Manager: «esp32 by Espressif», версия **2.0.x** (проверено на 2.0.17). Ядро 3.x не подходит (другой I2S API).
2. Library Manager: `SparkFun MAX3010x Pulse and Proximity Sensor Library`, `TinyGPSPlus`, `ArduinoJson` (7.x).
3. Откройте `qamqor_collar/qamqor_collar.ino` (для варианта с Wi-Fi: `local/qamqor_collar/qamqor_collar.ino`; папка должна называться так же, как файл).
4. Плата «ESP32 Dev Module», порт, Upload, Serial Monitor 115200.

## Прошивка: PlatformIO

```
pip install platformio
cd esp
pio run                 # сборка
pio run -t upload       # прошивка
pio device monitor      # лог, 115200
```

Если путь пользователя Windows содержит кириллицу, PlatformIO не находит `Arduino.h`: задайте ASCII-каталог ядра, например `PLATFORMIO_CORE_DIR=C:/pio_core`. Для варианта с реальным Wi-Fi временно подставьте его как `src_dir` или используйте Arduino IDE.

## Что делает прошивка

- Пульс (MAX30102) и GPS читаются непрерывно в `loop()`, без длинных пауз. Звук (I2S), зуммер и вибромотор работают как неблокирующий автомат шагов. Сеть работает в отдельной задаче на втором ядре, поэтому HTTP (до 30 с на холодном старте Render) не останавливает датчики.
- Пульс: `IR > 50000` = контакт; `checkForBeat`; BPM 40..200; сглаживание `0.7*avg + 0.3*bpm`; без контакта 0, тогда в запросе `heartRate: null`.
- Каждый интервал уходит `POST https://qamqor-api.onrender.com/api/v1/device/telemetry` (заголовок `X-Device-Code` и `code` в теле) с полями: `timestamp`, `latitude`, `longitude`, `accuracy` (HDOP x 5 м), `satellites`, `hdop`, `speedKmh`, `signal`, `heartRate` во всех режимах.
- Нет фикса, но позиция уже была: уходит последняя позиция с `accuracy` 999 м (сервер: зона UNKNOWN, оповещение GPS_LOST). Позиции не было ни разу: уходит запрос **без координат** (чтобы пульс и режим работали в помещении). Это требует, чтобы сервер принимал пинг без `latitude`/`longitude`/`accuracy`; **сейчас сервер эти поля требует и ответит 400** (повтор через 30 с).
- Ответ принимается только если `success == true` и `code` равен своему коду. Поле `mode`: `REAL` (по умолчанию до первого ответа), `PILOT`, `AUTO`.
- `REAL` и `AUTO`: команды сервера. Звук: 3 сигнала с растущим тоном от `toneFrequencyHz` вверх на динамике плюс зуммер, затем вибрация `vibrateDurationMs` (не дольше 5 с); `TEST_SOUND`, `TEST_VIBRATION` тоже выполняются.
- `PILOT`: зона и сигналы сервера игнорируются, идёт встроенный сценарий по кругу: зелёная (тишина, 10 с), жёлтая (растущие сигналы динамика и щелчки зуммера, 6 с), оранжевая (вибрация импульсами со звуком, 6 с), побег (чередующиеся сильные звук и вибрация, 4 с), возврат (тишина, 10 с). В `PILOT` пинги идут не реже чем раз в 15 с.
- Следующий пинг через `nextInterval` сервера, 5..3600 с (по умолчанию 300 с). Ошибки: 401 через 300 с; 400 через 60 с; 429 через `retryAfterSec`; сеть и 5xx с нарастающей паузой 10, 20 ... 300 с. При ошибке исполнительные устройства не включаются.

## Корневой сертификат (TLS)

Встроен GTS Root R4 (цепочка `onrender.com` <- Google Trust Services `WE1` <- `GTS Root R4`, проверено 2026-11-09 через `openssl s_client`, корень действует до 2036-06-22). Если связь падает с ошибкой сертификата:

```
openssl s_client -connect qamqor-api.onrender.com:443 -servername qamqor-api.onrender.com -showcerts
```

Замените PEM в `.ino` на новый самоподписанный корень цепочки. Отключать проверку нельзя.

## Что не проверено

- Работа на плате: пульс, GPS, I2S-динамик, зуммер, мотор, сценарий PILOT.
- Обмен с живым сервером; пинг без координат (см. выше).
- Громкость динамика (`AUDIO_AMPLITUDE`) и пороги пульса подобраны по описанию, не на железе.

## Протокол с сервером

Запрос `POST /api/v1/device/telemetry` (GPS и пульс всегда, независимо от режима):

```json
{"code":"12345678","timestamp":"2026-11-09T08:15:30Z","latitude":43.65012,"longitude":51.15731,"accuracy":6.5,"satellites":9,"hdop":1.3,"speedKmh":1.2,"signal":-71,"heartRate":64}
```

Без GPS-фикса (в помещении) координаты и `accuracy` опускаются все вместе, `timestamp` необязателен (берётся время сервера); `heartRate` — целое 20..250 или `null` (нет контакта):

```json
{"code":"12345678","heartRate":66,"satellites":0}
```

Ответ 200 (всегда с тем же `code`; `mode`: `REAL`, `PILOT` или `AUTO`):

```json
{"success":true,"mode":"REAL","code":"12345678","serverTime":"2026-11-09T08:15:31.204Z","nextInterval":300,"configVersion":1,"inFence":true,"zone":"YELLOW","distanceToBorderMeters":14.3,"toneFrequencyHz":1124,"sound":true,"vibrate":false,"vibrateDurationMs":0,"suppressedBy":null,"warningMessage":"Zone YELLOW: warning, 14.3 m to the border. Sound signal (1124 Hz)."}
```

Ответ на пакет без фикса: `zone:"UNKNOWN"`, `inFence:null`, `sound:false`, `vibrate:false`, остальные поля те же.

## Известный риск

8-значный код не секрет: тот, кто знает принятый код, может отправлять ложные позиции. Усиление позже: необязательный секрет или HMAC тела.
