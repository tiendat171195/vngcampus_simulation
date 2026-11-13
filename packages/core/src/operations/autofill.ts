import { type Db, missions, missionTemplates, uuidv7 } from '@campus/db';
import type { MapIndex } from '@campus/map-data';
import { missionDefinitionSchema } from '@campus/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { checkMissionForPublish } from '../missions/publish';
import { audit } from '../moderation/sanctions';
import { vnDateOf, vnDayBounds } from '../time';
import { readSettings } from './settings';

const DAY_MS = 86_400_000;
const vnClock = (iso: string) =>
  new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 19);

/**
 * Makes sure tomorrow has a daily mission (docs/08 §4.5): from 23:00 Vietnam time, if nobody
 * planned one, the least recently used active template that was not used in the last
 * `avoidDays` days is scheduled, keeping its hours. Templates that no longer pass the publish
 * checks are skipped. Returns the new mission's id, or null when nothing was needed or possible.
 */
export async function autofillTomorrow(
  db: Db,
  map: MapIndex,
  now = new Date(),
  options: { force?: boolean } = {},
): Promise<string | null> {
  const vnHour = new Date(now.getTime() + 7 * 3_600_000).getUTCHours();
  if (!options.force && vnHour < 23) return null;
  const config = await readSettings(db);
  if (!config.autofill.enabled) return null;
  const tomorrow = vnDateOf(new Date(now.getTime() + DAY_MS));
  const [planned] = await db
    .select({ id: missions.id })
    .from(missions)
    .where(
      and(
        eq(missions.kind, 'daily'),
        eq(missions.publishStatus, 'published'),
        eq(missions.dailyDate, tomorrow),
      ),
    );
  if (planned) return null;

  const templates = await db
    .select()
    .from(missionTemplates)
    .where(eq(missionTemplates.active, true))
    .orderBy(sql`${missionTemplates.lastUsedOn} asc nulls first`, asc(missionTemplates.createdAt));
  const { start } = vnDayBounds(tomorrow);
  const avoidFrom = vnDateOf(new Date(start.getTime() - config.autofill.avoidDays * DAY_MS));
  for (const template of templates) {
    if (template.lastUsedOn && template.lastUsedOn > avoidFrom) continue;
    const base = missionDefinitionSchema.safeParse(template.definition);
    if (!base.success) continue;
    const startsAt = Date.parse(`${tomorrow}T${vnClock(base.data.startsAt)}+07:00`);
    let endsAt = Date.parse(`${tomorrow}T${vnClock(base.data.endsAt)}+07:00`);
    // A template running until midnight ends at 00:00 the next day.
    if (endsAt <= startsAt) endsAt += DAY_MS;
    const definition = {
      ...base.data,
      kind: 'daily' as const,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      mapVersion: map.map.version,
    };
    const check = await checkMissionForPublish(db, definition, map);
    if (check.errors.length > 0 || !check.definition) continue;
    const id = uuidv7();
    try {
      await db.insert(missions).values({
        id,
        kind: 'daily',
        publishStatus: 'published',
        title: check.definition.title,
        description: check.definition.description,
        startsAt: new Date(check.definition.startsAt),
        endsAt: new Date(check.definition.endsAt),
        dailyDate: tomorrow,
        definition: check.definition,
        mapVersion: check.definition.mapVersion,
        autoFilled: true,
      });
    } catch {
      // Someone (or another process) planned tomorrow in the meantime.
      return null;
    }
    await db
      .update(missionTemplates)
      .set({ lastUsedOn: tomorrow })
      .where(eq(missionTemplates.id, template.id));
    await audit(db, {
      actorId: null,
      action: 'mission.autofill',
      entityType: 'mission',
      entityId: id,
      diff: { template: template.id, day: tomorrow },
    });
    return id;
  }
  return null;
}
