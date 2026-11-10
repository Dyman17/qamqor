export type PulseThreatLevel = 'NORMAL' | 'ELEVATED' | 'CRITICAL' | 'LOW' | 'UNKNOWN';

export interface SpeciesNorm {
  minNormal: number;
  maxNormal: number;
  criticalHigh: number;
  criticalLow: number;
  typicalResting: number;
  speciesNameRu: string;
  source: string;
  sourceNoteRu: string;
  isAssumption: boolean;
}

/**
 * Physiological vital signs referenced from the Merck Veterinary Manual
 * (Reference Guides > Physiologic Constants & Physical Examination of Farm Animals).
 * Species without comprehensive field IoT telemetry (e.g. grazing camel baseline)
 * are explicitly flagged with isAssumption: true.
 */
export const SPECIES_PULSE_NORMS: Record<string, SpeciesNorm> = {
  CATTLE: {
    minNormal: 60,
    maxNormal: 84,
    criticalHigh: 105,
    criticalLow: 45,
    typicalResting: 70,
    speciesNameRu: 'Корова',
    source: 'Merck Veterinary Manual (Physiologic Constants: Cattle)',
    sourceNoteRu: 'Взрослый КРС в покое: 60–84 уд/мин (телята: 100–120 уд/мин). Пульс > 105 указывает на острый стресс / угрозу хищника.',
    isAssumption: false,
  },
  HORSE: {
    minNormal: 28,
    maxNormal: 44,
    criticalHigh: 60,
    criticalLow: 24,
    typicalResting: 36,
    speciesNameRu: 'Лошадь',
    source: 'Merck Veterinary Manual (Physical Examination: Horses)',
    sourceNoteRu: 'Взрослые лошади в покое: 28–44 уд/мин (жеребята: 60–80 уд/мин). Пульс > 60 указывает на колики, испуг или панику.',
    isAssumption: false,
  },
  SHEEP: {
    minNormal: 70,
    maxNormal: 90,
    criticalHigh: 115,
    criticalLow: 55,
    typicalResting: 75,
    speciesNameRu: 'Овца',
    source: 'Merck Veterinary Manual (Physical Examination: Sheep)',
    sourceNoteRu: 'Взрослые овцы в покое: 70–90 уд/мин (ягнята: 100–120 уд/мин). Пульс > 115 указывает на нападение хищника или бегство.',
    isAssumption: false,
  },
  GOAT: {
    minNormal: 70,
    maxNormal: 90,
    criticalHigh: 115,
    criticalLow: 55,
    typicalResting: 80,
    speciesNameRu: 'Коза',
    source: 'Merck Veterinary Manual (Physical Examination: Goats)',
    sourceNoteRu: 'Взрослые козы в покое: 70–90 уд/мин (козлята: 90–120 уд/мин). Пульс > 115 указывает на острый испуг / опасность.',
    isAssumption: false,
  },
  CAMEL: {
    minNormal: 32,
    maxNormal: 50,
    criticalHigh: 70,
    criticalLow: 25,
    typicalResting: 40,
    speciesNameRu: 'Верблюд',
    source: 'Merck Veterinary Manual (Camelidae)',
    sourceNoteRu: 'Взрослые верблюды в покое: 32–50 уд/мин. Базовый уровень выгула 40 уд/мин принят как допущение из-за малого числа полевых сенсорных данных.',
    isAssumption: true,
  },
};

export interface PulseThreatDto {
  level: PulseThreatLevel;
  score: number; // 0-100 threat score
  labelRu: string;
  labelKk: string;
  labelEn: string;
  normalMin: number;
  normalMax: number;
  baseline: number;
  deltaPercent: number;
  source: string;
  sourceNoteRu: string;
  isAssumption: boolean;
}

/**
 * Anti-spike filter: smooths raw sensor readings and suppresses wild optical harmonic spikes.
 * A physiological heart rate cannot jump > 40 BPM in 1 second.
 */
export function smoothHeartRate(prevBpm: number | null | undefined, rawBpm: number): number {
  if (rawBpm < 20 || rawBpm > 240) return prevBpm ?? rawBpm;
  if (prevBpm == null || prevBpm <= 0) return rawBpm;

  const diff = Math.abs(rawBpm - prevBpm);
  // Heavy jump suppression (e.g. sensor artifact or light flash)
  if (diff > 40) {
    return Math.round(0.75 * prevBpm + 0.25 * rawBpm);
  }
  // Normal physiological smoothing
  return Math.round(0.4 * prevBpm + 0.6 * rawBpm);
}

/**
 * Computes threat and physiological state based on animal species and current pulse.
 * Uses Merck Veterinary Manual physiological constants with explicit assumption tags.
 */
export function computePulseThreat(species: string | null | undefined, bpm: number | null | undefined): PulseThreatDto {
  const norm = SPECIES_PULSE_NORMS[species ?? 'CATTLE'] ?? SPECIES_PULSE_NORMS.CATTLE;

  if (bpm == null || bpm <= 0) {
    return {
      level: 'UNKNOWN',
      score: 0,
      labelRu: 'Нет данных',
      labelKk: 'Мәлімет жоқ',
      labelEn: 'No data',
      normalMin: norm.minNormal,
      normalMax: norm.maxNormal,
      baseline: norm.typicalResting,
      deltaPercent: 0,
      source: norm.source,
      sourceNoteRu: norm.sourceNoteRu,
      isAssumption: norm.isAssumption,
    };
  }

  const deltaPercent = Math.round(((bpm - norm.typicalResting) / norm.typicalResting) * 100);

  // Critical danger: predator, severe panic, injury, escaping
  if (bpm >= norm.criticalHigh) {
    return {
      level: 'CRITICAL',
      score: Math.min(100, 85 + Math.round((bpm - norm.criticalHigh) * 0.5)),
      labelRu: 'Опасность / Острый стресс!',
      labelKk: 'Қауіп / Жедел күйзеліс!',
      labelEn: 'Critical Threat / Acute Stress!',
      normalMin: norm.minNormal,
      normalMax: norm.maxNormal,
      baseline: norm.typicalResting,
      deltaPercent,
      source: norm.source,
      sourceNoteRu: norm.sourceNoteRu,
      isAssumption: norm.isAssumption,
    };
  }

  // Elevated: active locomotion, herding, excitement
  if (bpm > norm.maxNormal) {
    return {
      level: 'ELEVATED',
      score: 45 + Math.round(((bpm - norm.maxNormal) / (norm.criticalHigh - norm.maxNormal)) * 35),
      labelRu: 'Повышен (активность / стресс)',
      labelKk: 'Жоғары (белсенділік / күйзеліс)',
      labelEn: 'Elevated (active / stress)',
      normalMin: norm.minNormal,
      normalMax: norm.maxNormal,
      baseline: norm.typicalResting,
      deltaPercent,
      source: norm.source,
      sourceNoteRu: norm.sourceNoteRu,
      isAssumption: norm.isAssumption,
    };
  }

  // Abnormally low: bradycardia, hypothermia, weakness
  if (bpm < norm.criticalLow) {
    return {
      level: 'LOW',
      score: 65,
      labelRu: 'Аномально низкий',
      labelKk: 'Қалыптан тым төмен',
      labelEn: 'Abnormally low',
      normalMin: norm.minNormal,
      normalMax: norm.maxNormal,
      baseline: norm.typicalResting,
      deltaPercent,
      source: norm.source,
      sourceNoteRu: norm.sourceNoteRu,
      isAssumption: norm.isAssumption,
    };
  }

  // Normal calm / resting state
  return {
    level: 'NORMAL',
    score: Math.max(0, Math.min(25, Math.round(((bpm - norm.minNormal) / (norm.maxNormal - norm.minNormal)) * 25))),
    labelRu: 'В норме (покой)',
    labelKk: 'Қалыпты (тыныш)',
    labelEn: 'Normal (resting)',
    normalMin: norm.minNormal,
    normalMax: norm.maxNormal,
    baseline: norm.typicalResting,
    deltaPercent,
    source: norm.source,
    sourceNoteRu: norm.sourceNoteRu,
    isAssumption: norm.isAssumption,
  };
}
