#pragma once
#include <Arduino.h>

void actuatorsBegin();
void actuatorsOff();
// Beep pattern at freqHz (clamped).
void playSound(int freqHz);
// Vibrate for durationMs (clamped).
void vibrateFor(int durationMs);
