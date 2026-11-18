/** Regenerates the photo survey maps (docs/survey/*.svg) and the zone list in docs/12. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SURVEY_ZONES } from '@campus/map-data/survey';
import { SURVEY_DIR, SURVEY_DOC } from './paths';
import { renderSurveySheet, SURVEY_SHEETS, updateSurveyDoc } from './survey-docs';

mkdirSync(SURVEY_DIR, { recursive: true });
for (const sheet of SURVEY_SHEETS) {
  writeFileSync(join(SURVEY_DIR, sheet.file), renderSurveySheet(sheet));
}
writeFileSync(SURVEY_DOC, updateSurveyDoc(readFileSync(SURVEY_DOC, 'utf8')));
const stations = SURVEY_ZONES.reduce((sum, zone) => sum + zone.stations.length, 0);
console.log(
  `Wrote ${SURVEY_SHEETS.length} maps to ${SURVEY_DIR} and the zone list of ${SURVEY_DOC}: ${SURVEY_ZONES.length} zones, ${stations} standing points`,
);
