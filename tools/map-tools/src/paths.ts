import { fileURLToPath } from 'node:url';

const fromRoot = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

export const OSM_EXTRACT = fromRoot('docs/reference/osm-campus.geojson');
export const CAMPUS_JSON = fromRoot('packages/map-data/src/campus.json');
