#include "gps.h"
#include "config.h"
#include <TinyGPSPlus.h>

static TinyGPSPlus gps;
static HardwareSerial gpsSerial(2);
static bool haveLast = false;
static double lastLat = 0, lastLng = 0;

void gpsBegin() {
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
}

void gpsPump() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
}

static bool fresh() {
  return gps.location.isValid() && gps.location.age() < GPS_MAX_AGE_MS;
}

bool gpsWaitForFix(uint32_t waitMs) {
  uint32_t start = millis();
  while (millis() - start < waitMs) {
    gpsPump();
    if (fresh()) return true;
    delay(10);
  }
  gpsPump();
  return fresh();
}

GpsFix gpsGet() {
  gpsPump();
  GpsFix f{};
  f.hdop = gps.hdop.isValid() ? gps.hdop.hdop() : -1;
  f.satellites = gps.satellites.isValid() ? (int)gps.satellites.value() : -1;
  f.speedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0;
  f.valid = fresh();
  if (f.valid) {
    f.lat = gps.location.lat();
    f.lng = gps.location.lng();
    f.accuracy = f.hdop >= 0 ? max(1.0, f.hdop * ACCURACY_PER_HDOP_M) : ACCURACY_NO_FIX_M;
    haveLast = true;
    lastLat = f.lat;
    lastLng = f.lng;
  }
  return f;
}

bool gpsLastKnown(double &lat, double &lng) {
  if (!haveLast) return false;
  lat = lastLat;
  lng = lastLng;
  return true;
}
