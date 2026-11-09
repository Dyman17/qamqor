#pragma once
#include <Arduino.h>

struct GpsFix {
  bool valid;          // current, fresh fix
  double lat, lng;
  double accuracy;     // metres (estimated from HDOP)
  double speedKmh;
  double hdop;         // < 0 if unknown
  int satellites;      // < 0 if unknown
};

void gpsBegin();
// Feed bytes from the GPS UART to the parser. Call often.
void gpsPump();
// Pump for up to waitMs, stop early once a fresh fix exists. Returns true if there is a fix.
bool gpsWaitForFix(uint32_t waitMs);
GpsFix gpsGet();
// Last position that was ever valid (sent with bad accuracy when the fix is lost).
bool gpsLastKnown(double &lat, double &lng);
