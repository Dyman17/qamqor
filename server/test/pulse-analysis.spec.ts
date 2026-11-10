import { computePulseThreat, smoothHeartRate, SPECIES_PULSE_NORMS } from '../src/animals/pulse-analysis';

describe('pulse analysis and threat levels by species based on Merck Veterinary Manual', () => {
  it('correctly classifies cattle pulse with Merck norms (60-84 bpm)', () => {
    // Cattle normal: 60-84, critical: 105
    const norm = computePulseThreat('CATTLE', 65);
    expect(norm).toMatchObject({
      level: 'NORMAL',
      normalMin: 60,
      normalMax: 84,
      baseline: 70,
      isAssumption: false,
    });
    expect(norm.source).toContain('Merck');
    expect(computePulseThreat('CATTLE', 90)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('CATTLE', 120)).toMatchObject({ level: 'CRITICAL' });
    expect(computePulseThreat('CATTLE', 40)).toMatchObject({ level: 'LOW' });
    expect(computePulseThreat('CATTLE', null)).toMatchObject({ level: 'UNKNOWN' });
  });

  it('correctly classifies horse pulse (resting pulse 28-44)', () => {
    // Horse normal: 28-44, critical: 60
    const norm = computePulseThreat('HORSE', 35);
    expect(norm).toMatchObject({
      level: 'NORMAL',
      normalMin: 28,
      normalMax: 44,
      baseline: 36,
      isAssumption: false,
    });
    expect(computePulseThreat('HORSE', 52)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('HORSE', 75)).toMatchObject({ level: 'CRITICAL' });
    expect(computePulseThreat('HORSE', 20)).toMatchObject({ level: 'LOW' });
  });

  it('correctly classifies sheep and goat pulse (resting pulse 70-90)', () => {
    // Sheep normal: 70-90, critical: 115
    expect(computePulseThreat('SHEEP', 78)).toMatchObject({ level: 'NORMAL', isAssumption: false });
    expect(computePulseThreat('SHEEP', 100)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('SHEEP', 130)).toMatchObject({ level: 'CRITICAL' });
    expect(computePulseThreat('GOAT', 75)).toMatchObject({ level: 'NORMAL', normalMin: 70, normalMax: 90 });
  });

  it('correctly classifies camel pulse and marks grazing baseline as assumption', () => {
    // Camel normal: 32-50, baseline: 40 (assumption)
    const norm = computePulseThreat('CAMEL', 40);
    expect(norm).toMatchObject({
      level: 'NORMAL',
      normalMin: 32,
      normalMax: 50,
      baseline: 40,
      isAssumption: true,
    });
    expect(norm.source).toContain('Merck');
    expect(norm.sourceNoteRu).toContain('допущение');
    expect(computePulseThreat('CAMEL', 58)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('CAMEL', 75)).toMatchObject({ level: 'CRITICAL' });
  });

  it('smooths sudden optical harmonic spikes', () => {
    // If previous is 60, raw is 150 (spike of 90 bpm)
    const smoothed = smoothHeartRate(60, 150);
    // 0.75 * 60 + 0.25 * 150 = 45 + 37.5 = 83 (heavily suppressed, not jumping to 150)
    expect(smoothed).toBeLessThan(90);
    expect(smoothed).toBeGreaterThan(60);

    // Initial reading when prev is null
    expect(smoothHeartRate(null, 65)).toBe(65);

    // Moderate jump: 60 -> 75
    const mod = smoothHeartRate(60, 75);
    // 0.4 * 60 + 0.6 * 75 = 24 + 45 = 69
    expect(mod).toBe(69);
  });
});
