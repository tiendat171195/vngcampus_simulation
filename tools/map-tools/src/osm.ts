import { readFileSync } from 'node:fs';
import { latLonToLocal, roundVec, type Vec2 } from '@campus/map-data';

interface Feature {
  properties: { osm_way: number; kind: string; name: string };
  geometry:
    | { type: 'Polygon'; coordinates: [number, number][][] }
    | { type: 'LineString'; coordinates: [number, number][] };
}

export interface OsmExtract {
  /** Vertices of an OSM way in campus-local metres. Polygons come without the closing vertex. */
  way(id: number): Vec2[];
}

/** Reads the extract in docs/reference and projects it into the campus-local frame. */
export function loadOsmExtract(path: string): OsmExtract {
  const collection = JSON.parse(readFileSync(path, 'utf8')) as { features: Feature[] };
  const ways = new Map<number, Vec2[]>();

  for (const feature of collection.features) {
    const isPolygon = feature.geometry.type === 'Polygon';
    const lonLat = isPolygon
      ? ((feature.geometry.coordinates as [number, number][][])[0] ?? [])
      : (feature.geometry.coordinates as [number, number][]);
    const points = lonLat.map(([lon, lat]) => roundVec(latLonToLocal(lat, lon)));
    if (isPolygon) points.pop();
    ways.set(feature.properties.osm_way, points);
  }

  return {
    way(id) {
      const points = ways.get(id);
      if (!points) throw new Error(`OSM way ${id} is not in the extract`);
      return points;
    },
  };
}
