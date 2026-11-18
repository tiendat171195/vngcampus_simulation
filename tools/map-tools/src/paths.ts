import { fileURLToPath } from 'node:url';

const fromRoot = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

export const OSM_EXTRACT = fromRoot('docs/reference/osm-campus.geojson');
export const CAMPUS_JSON = fromRoot('packages/map-data/src/campus.json');
export const SURVEY_DOC = fromRoot('docs/12-photo-survey.md');
export const SURVEY_DIR = fromRoot('docs/survey');
