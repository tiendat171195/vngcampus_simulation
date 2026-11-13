/** Regenerates packages/map-data/src/campus.json from the OpenStreetMap extract. */
import { writeFileSync } from 'node:fs';
import { polygonArea } from '@campus/map-data';
import { buildCampusV0 } from './campus-v0';
import { formatCampusMap } from './format';
import { loadOsmExtract } from './osm';
import { CAMPUS_JSON, OSM_EXTRACT } from './paths';

const map = buildCampusV0(loadOsmExtract(OSM_EXTRACT));
writeFileSync(CAMPUS_JSON, formatCampusMap(map));

const count = (label: string, value: number) => `${String(value).padStart(5)}  ${label}`;
console.log(
  [
    `Wrote ${CAMPUS_JSON}`,
    `map version ${map.version}`,
    count('areas', map.areas.length),
    count('structures', map.structures.length),
    count('paths', map.paths.length),
    count('connectors', map.connectors.length),
    count('POIs', map.pois.length),
    count(
      'prop instances',
      map.props.reduce((sum, group) => sum + group.instances.length, 0),
    ),
    count(
      'm² of building footprint',
      Math.round(map.structures.reduce((sum, s) => sum + polygonArea(s.footprint), 0)),
    ),
  ].join('\n'),
);
