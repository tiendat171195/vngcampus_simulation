import { describe, expect, it } from 'vitest';
import { CAMPUS_FRAME, latLonToLocal, localToLatLon } from './frame';

describe('campus-local frame', () => {
  it('puts the origin at (0, 0)', () => {
    const [x, z] = latLonToLocal(CAMPUS_FRAME.origin.lat, CAMPUS_FRAME.origin.lon);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  // Vertices of the main block and the riverside café, with the local coordinates recorded in
  // docs/reference/osm-campus.geojson.
  it.each([
    { lon: 106.7459038, lat: 10.7589442, expected: [35.2, -34.4] },
    { lon: 106.7464765, lat: 10.7587863, expected: [60.0, 25.7] },
    { lon: 106.7461617, lat: 10.7580756, expected: [-23.1, 46.9] },
    { lon: 106.7465388, lat: 10.7586274, expected: [50.3, 41.8] },
  ])('matches the reference extract at $lat, $lon', ({ lat, lon, expected }) => {
    const [x, z] = latLonToLocal(lat, lon);
    expect(x).toBeCloseTo(expected[0] as number, 1);
    expect(z).toBeCloseTo(expected[1] as number, 1);
  });

  it('has +X pointing north-east and +Z pointing south-east', () => {
    const alongX = localToLatLon([100, 0]);
    expect(alongX.lat).toBeGreaterThan(CAMPUS_FRAME.origin.lat);
    expect(alongX.lon).toBeGreaterThan(CAMPUS_FRAME.origin.lon);
    const alongZ = localToLatLon([0, 100]);
    expect(alongZ.lat).toBeLessThan(CAMPUS_FRAME.origin.lat);
    expect(alongZ.lon).toBeGreaterThan(CAMPUS_FRAME.origin.lon);
  });

  it('round-trips', () => {
    const [x, z] = latLonToLocal(
      ...(Object.values(localToLatLon([-117.25, 49.5])) as [number, number]),
    );
    expect(x).toBeCloseTo(-117.25, 6);
    expect(z).toBeCloseTo(49.5, 6);
  });
});
