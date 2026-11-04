import { GeofenceService } from '../src/geofences/geofence.service';
import { GeofenceStatus } from '@qamqor/shared';

describe('GeofenceService (Point-in-Polygon & False Positive Filter)', () => {
  let service: GeofenceService;

  // Pasture Polygon (Мангистау даласы)
  // Box: Lat 43.6450 to 43.6550, Lng 51.1500 to 51.1650
  const samplePasture = {
    type: 'Polygon',
    coordinates: [
      [
        [51.1500, 43.6450],
        [51.1650, 43.6450],
        [51.1650, 43.6550],
        [51.1500, 43.6550],
        [51.1500, 43.6450],
      ],
    ],
  };

  beforeEach(() => {
    service = new GeofenceService(null as any);
  });

  it('should identify point INSIDE pasture polygon', () => {
    const pointInside = { latitude: 43.6500, longitude: 51.1550 };
    const inside = service.isPointInPolygon(pointInside, samplePasture);
    expect(inside).toBe(true);
  });

  it('should identify point OUTSIDE pasture polygon (Breach)', () => {
    const pointOutside = { latitude: 43.6650, longitude: 51.1750 };
    const inside = service.isPointInPolygon(pointOutside, samplePasture);
    expect(inside).toBe(false);
  });

  it('should mark GPS fix as UNRELIABLE when accuracy is poor (> 35m)', () => {
    const badGpsPoint = { latitude: 43.6650, longitude: 51.1750, accuracy: 48 };
    const evaluation = service.evaluateLocation(badGpsPoint, samplePasture);

    expect(evaluation.isReliable).toBe(false);
  });

  it('should evaluate OUTSIDE and RELIABLE when horse escapes with good GPS fix (<= 35m)', () => {
    const horseEscape = { latitude: 43.6650, longitude: 51.1750, accuracy: 4.5 };
    const evaluation = service.evaluateLocation(horseEscape, samplePasture);

    expect(evaluation.isReliable).toBe(true);
    expect(evaluation.status).toBe(GeofenceStatus.OUTSIDE);
  });

  // ==========================================
  // 4-ZONE SPATIAL LIVESTOCK STEERING TESTS
  // ==========================================

  describe('4-Zone Steering & Distance Calculations', () => {
    it('should calculate distance to closest polygon edge accurately', () => {
      // Point directly on northern edge (lat 43.6550)
      const onEdge = { latitude: 43.6550, longitude: 51.1575 };
      const distOnEdge = service.distanceToPolygonEdgeMeters(onEdge, samplePasture);
      expect(distOnEdge).toBeLessThan(1); // Within 1 meter

      // Point in center
      const inCenter = { latitude: 43.6500, longitude: 51.1575 };
      const distInCenter = service.distanceToPolygonEdgeMeters(inCenter, samplePasture);
      expect(distInCenter).toBeGreaterThan(500);
    });

    it('should assign GREEN zone (>20m inside) with toneFrequencyHz = 0', () => {
      // Deep inside pasture (~550m from border)
      const point = { latitude: 43.6500, longitude: 51.1575, accuracy: 3.0 };
      const evalResult = service.evaluateLocation(point, samplePasture);

      expect(evalResult.status).toBe(GeofenceStatus.INSIDE);
      expect(evalResult.zone).toBe('GREEN');
      expect(evalResult.distanceMeters).toBeGreaterThan(20);
      expect(evalResult.toneFrequencyHz).toBe(0);
    });

    it('should assign YELLOW zone (5m to 20m inside) with scaled audio frequency (800 - 1600 Hz)', () => {
      // ~11m inside northern border (lat 43.6550 - 0.00010 = 43.65490)
      const point = { latitude: 43.65490, longitude: 51.1575, accuracy: 3.0 };
      const evalResult = service.evaluateLocation(point, samplePasture);

      expect(evalResult.status).toBe(GeofenceStatus.INSIDE);
      expect(evalResult.zone).toBe('YELLOW');
      expect(evalResult.distanceMeters).toBeGreaterThan(5);
      expect(evalResult.distanceMeters).toBeLessThanOrEqual(20);
      expect(evalResult.toneFrequencyHz).toBeGreaterThanOrEqual(800);
      expect(evalResult.toneFrequencyHz).toBeLessThanOrEqual(1600);
    });

    it('should assign ORANGE zone (0m to 5m inside) with scaled audio frequency (1600 - 2400 Hz)', () => {
      // ~2.2m inside northern border (lat 43.6550 - 0.00002 = 43.65498)
      const point = { latitude: 43.65498, longitude: 51.1575, accuracy: 2.0 };
      const evalResult = service.evaluateLocation(point, samplePasture);

      expect(evalResult.status).toBe(GeofenceStatus.INSIDE);
      expect(evalResult.zone).toBe('ORANGE');
      expect(evalResult.distanceMeters).toBeLessThanOrEqual(5);
      expect(evalResult.toneFrequencyHz).toBeGreaterThanOrEqual(1600);
      expect(evalResult.toneFrequencyHz).toBeLessThanOrEqual(2400);
    });

    it('should assign RED zone (0m to 100m outside) with 2400 Hz siren', () => {
      // ~22m outside northern border (lat 43.6550 + 0.00020 = 43.65520)
      const point = { latitude: 43.65520, longitude: 51.1575, accuracy: 3.0 };
      const evalResult = service.evaluateLocation(point, samplePasture);

      expect(evalResult.status).toBe(GeofenceStatus.OUTSIDE);
      expect(evalResult.zone).toBe('RED');
      expect(evalResult.distanceMeters).toBeLessThanOrEqual(100);
      expect(evalResult.toneFrequencyHz).toBe(2400);
    });

    it('should assign ESCAPE zone (>100m outside) and disarm tone to prevent panic', () => {
      // ~220m outside northern border (lat 43.6550 + 0.00200 = 43.65700)
      const point = { latitude: 43.65700, longitude: 51.1575, accuracy: 3.0 };
      const evalResult = service.evaluateLocation(point, samplePasture);

      expect(evalResult.status).toBe(GeofenceStatus.OUTSIDE);
      expect(evalResult.zone).toBe('ESCAPE');
      expect(evalResult.distanceMeters).toBeGreaterThan(100);
      expect(evalResult.toneFrequencyHz).toBe(0);
    });

    it('should trigger ESCAPE / Anti-Panic if speed > 15 km/h outside border even if < 100m', () => {
      // 22m outside, running at 18 km/h (horse galloping in panic)
      const point = { latitude: 43.65520, longitude: 51.1575, accuracy: 3.0, speed: 18.0 };
      const evalResult = service.evaluateLocation(point, samplePasture);

      expect(evalResult.status).toBe(GeofenceStatus.OUTSIDE);
      expect(evalResult.zone).toBe('ESCAPE');
      expect(evalResult.toneFrequencyHz).toBe(0);
    });
  });
});

