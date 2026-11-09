#pragma once
#include <Arduino.h>

enum class SendResult { OK, REJECTED_CODE, BAD_AUTH, BAD_REQUEST, RATE_LIMITED, SERVER_ERROR, NETWORK_ERROR };

struct SendOutcome {
  SendResult result;
  int nextIntervalSec;   // seconds to wait before the next attempt
};

bool wifiEnsure();                 // (re)connect; true when connected
bool timeSync();                   // NTP; true when the clock is valid
bool timeValid();
// Build, send and process one telemetry ping; runs the actuators on success.
SendOutcome sendTelemetry(double lat, double lng, double accuracy, double speedKmh, double hdop, int satellites);
