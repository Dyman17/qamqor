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
});

