/**
 * The campus-local coordinate frame (docs/03-world-and-assets.md §2).
 *
 * Origin is the centroid of the main block; +X runs along Tân Thuận road towards the north-east,
 * +Z points at the Saigon river, Y is up. Seen from above this matches three.js: X right, Z down.
 */

/** Position on a floor, in metres: [x, z]. */
export type Vec2 = readonly [x: number, z: number];

export const CAMPUS_FRAME = {
  origin: { lat: 10.7585017, lon: 106.7459539 },
  /** Compass bearing of +X, degrees clockwise from true north. +Z is this plus 90°. */
  xAxisBearingDeg: 38,
} as const;

const METRES_PER_DEG_LAT = 110_574;
const METRES_PER_DEG_LON_AT_EQUATOR = 111_320;
const DEG = Math.PI / 180;

const metresPerDegLon = METRES_PER_DEG_LON_AT_EQUATOR * Math.cos(CAMPUS_FRAME.origin.lat * DEG);
const bearing = CAMPUS_FRAME.xAxisBearingDeg * DEG;
const sinB = Math.sin(bearing);
const cosB = Math.cos(bearing);

/**
 * WGS84 → campus-local metres. Uses a flat-earth approximation around the origin, which is
 * accurate to a few centimetres across the few hundred metres the campus spans.
 */
export function latLonToLocal(lat: number, lon: number): Vec2 {
  const east = (lon - CAMPUS_FRAME.origin.lon) * metresPerDegLon;
  const north = (lat - CAMPUS_FRAME.origin.lat) * METRES_PER_DEG_LAT;
  return [east * sinB + north * cosB, east * cosB - north * sinB];
}

/** Inverse of {@link latLonToLocal}. */
export function localToLatLon([x, z]: Vec2): { lat: number; lon: number } {
  const east = x * sinB + z * cosB;
  const north = x * cosB - z * sinB;
  return {
    lat: CAMPUS_FRAME.origin.lat + north / METRES_PER_DEG_LAT,
    lon: CAMPUS_FRAME.origin.lon + east / metresPerDegLon,
  };
}
