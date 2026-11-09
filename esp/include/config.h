// Qamqor collar: hardware pins and protocol settings. Pins are ASSUMPTIONS for an ESP32 DevKit
// (30/38-pin); change them to match the real wiring. Secrets live in secrets.h, not here.
#pragma once

// ---- Server ----
#define SERVER_HOST "qamqor-api.onrender.com"
#define TELEMETRY_URL "https://" SERVER_HOST "/api/v1/device/telemetry"

// ---- Pins (assumed) ----
#define GPS_RX_PIN 16        // ESP32 RX2  <- GPS module TX
#define GPS_TX_PIN 17        // ESP32 TX2  -> GPS module RX
#define GPS_BAUD 9600        // typical NEO-6M/7M/8M default
#define BUZZER_PIN 25        // passive buzzer / speaker, driven with LEDC tone
#define VIBRATION_PIN 26     // vibration motor via NPN transistor (+ flyback diode); HIGH = on
#define BUZZER_LEDC_CHANNEL 0

// ---- Timing (seconds unless noted) ----
#define DEFAULT_INTERVAL_SEC 300        // normal ping interval; used until the server says otherwise
#define MIN_INTERVAL_SEC 5              // bounds applied to the server's nextInterval
#define MAX_INTERVAL_SEC 3600
#define NO_FIX_RETRY_SEC 30             // no GPS fix and no earlier position: try again soon
#define GPS_FIX_WAIT_MS 15000           // how long to wait for a fix before each send
#define GPS_MAX_AGE_MS 10000            // a fix older than this counts as lost
#define HTTP_TIMEOUT_MS 30000           // Render free plan cold start can take ~30 s
#define WIFI_CONNECT_TIMEOUT_MS 20000
#define NTP_WAIT_MS 15000
#define BACKOFF_MIN_SEC 10
#define BACKOFF_MAX_SEC 300

// ---- Accuracy ----
#define ACCURACY_PER_HDOP_M 5.0         // assumption: accuracy (m) ~ HDOP * 5
#define ACCURACY_NO_FIX_M 999.0         // sent with the last known position when the fix is lost (server => zone UNKNOWN, GPS_LOST)

// ---- Actuators ----
#define SOUND_BEEPS 3
#define SOUND_BEEP_MS 250
#define SOUND_GAP_MS 150
#define VIBRATION_MAX_MS 5000           // upper bound on server-requested vibration
#define TEST_VIBRATION_MS 1000
#define TEST_SOUND_HZ 1000
#define TONE_MIN_HZ 100
#define TONE_MAX_HZ 5000
