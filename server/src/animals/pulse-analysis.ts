export type PulseThreatLevel = 'NORMAL' | 'ELEVATED' | 'CRITICAL' | 'LOW' | 'UNKNOWN';

export interface SpeciesNorm {
  minNormal: number;
  maxNormal: number;
  criticalHigh: number;
  criticalLow: number;
  typicalResting: number;
  speciesNameRu: string;
}

export const SPECIES_PULSE_NORMS: Record<string, SpeciesNorm> = {
  CATTLE: {
    minNormal: 50,
    maxNormal: 80,
    criticalHigh: 105,
    criticalLow: 45,
    typicalResting: 60,
    speciesNameRu: 'Корова',
  },
  HORSE: {
    minNormal: 28,
    maxNormal: 45,
    criticalHigh: 60,
    criticalLow: 24,
    typicalResting: 36,
    speciesNameRu: 'Лошадь',
  },
  SHEEP: {
    minNormal: 70,
    maxNormal: 90,
    criticalHigh: 115,
    criticalLow: 60,
    typicalResting: 75,
    speciesNameRu: 'Овца',
  },
  GOAT: {
    minNormal: 70,
    maxNormal: 95,
    criticalHigh: 120,
    criticalLow: 60,
    typicalResting: 80,
    speciesNameRu: 'Коза',
  },
  CAMEL: {
    minNormal: 30,
    maxNormal: 50,
    criticalHigh: 70,
    criticalLow: 25,
    typicalResting: 40,
    speciesNameRu: 'Верблюд',
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
  };
}

