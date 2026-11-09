import { computePulseThreat, smoothHeartRate, SPECIES_PULSE_NORMS } from '../src/animals/pulse-analysis';

describe('pulse analysis and threat levels by species', () => {
  it('correctly classifies cattle pulse', () => {
    // Cattle normal: 50-80, critical: 105
    expect(computePulseThreat('CATTLE', 65)).toMatchObject({ level: 'NORMAL', normalMin: 50, normalMax: 80 });
    expect(computePulseThreat('CATTLE', 90)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('CATTLE', 120)).toMatchObject({ level: 'CRITICAL' });
    expect(computePulseThreat('CATTLE', 40)).toMatchObject({ level: 'LOW' });
    expect(computePulseThreat('CATTLE', null)).toMatchObject({ level: 'UNKNOWN' });
  });

  it('correctly classifies horse pulse (much lower resting pulse 28-45)', () => {
    // Horse normal: 28-45, critical: 60
    expect(computePulseThreat('HORSE', 35)).toMatchObject({ level: 'NORMAL', normalMin: 28, normalMax: 45 });
    expect(computePulseThreat('HORSE', 52)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('HORSE', 75)).toMatchObject({ level: 'CRITICAL' });
    expect(computePulseThreat('HORSE', 20)).toMatchObject({ level: 'LOW' });
  });

  it('correctly classifies sheep and goat pulse (higher resting pulse 70-90)', () => {
    // Sheep normal: 70-90, critical: 115
    expect(computePulseThreat('SHEEP', 78)).toMatchObject({ level: 'NORMAL' });
    expect(computePulseThreat('SHEEP', 100)).toMatchObject({ level: 'ELEVATED' });
    expect(computePulseThreat('SHEEP', 130)).toMatchObject({ level: 'CRITICAL' });
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
