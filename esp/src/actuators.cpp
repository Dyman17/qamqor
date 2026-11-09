#include "actuators.h"
#include "config.h"

void actuatorsBegin() {
  pinMode(VIBRATION_PIN, OUTPUT);
  digitalWrite(VIBRATION_PIN, LOW);
  ledcSetup(BUZZER_LEDC_CHANNEL, 2000, 8);
  ledcAttachPin(BUZZER_PIN, BUZZER_LEDC_CHANNEL);
  ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
}

void actuatorsOff() {
  ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
  digitalWrite(VIBRATION_PIN, LOW);
}

void playSound(int freqHz) {
  freqHz = constrain(freqHz, TONE_MIN_HZ, TONE_MAX_HZ);
  Serial.printf("[act] sound %d Hz x%d\n", freqHz, SOUND_BEEPS);
  for (int i = 0; i < SOUND_BEEPS; i++) {
    ledcWriteTone(BUZZER_LEDC_CHANNEL, freqHz);
    delay(SOUND_BEEP_MS);
    ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
    delay(SOUND_GAP_MS);
  }
}

void vibrateFor(int durationMs) {
  durationMs = constrain(durationMs, 0, VIBRATION_MAX_MS);
  if (durationMs == 0) return;
  Serial.printf("[act] vibration %d ms\n", durationMs);
  digitalWrite(VIBRATION_PIN, HIGH);
  delay(durationMs);
  digitalWrite(VIBRATION_PIN, LOW);
}
