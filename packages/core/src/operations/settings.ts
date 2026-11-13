import { announcements, type Db, settings } from '@campus/db';
import {
  DEFAULT_SETTINGS,
  type OperationalSettings,
  operationalSettingsSchema,
  type SettingsPatch,
} from '@campus/shared';
import { and, asc, gt, inArray, isNull, lte } from 'drizzle-orm';
import { audit } from '../moderation/sanctions';

/**
 * What the team can change without a deploy (docs/08 §5). Stored one key per row in `settings`;
 * a missing or unreadable key takes its default.
 */
const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof OperationalSettings)[];

export async function readSettings(db: Db): Promise<OperationalSettings> {
  const rows = await db.select().from(settings).where(inArray(settings.key, KEYS));
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const field = operationalSettingsSchema.shape[row.key as keyof OperationalSettings];
    const parsed = field?.safeParse(row.value);
    if (parsed?.success) result[row.key] = parsed.data;
  }
  return result as OperationalSettings;
}

/** Saves some settings and notes what changed in the audit log. */
export async function writeSettings(
  db: Db,
  patch: SettingsPatch,
  actorId: string,
): Promise<OperationalSettings> {
  const before = await readSettings(db);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === 'holidays') (value as string[]).sort();
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    if (JSON.stringify(value) !== JSON.stringify(before[key]))
      changed[key] = { from: before[key], to: value };
  }
  if (Object.keys(changed).length > 0)
    await audit(db, {
      actorId,
      action: 'settings.update',
      entityType: 'settings',
      entityId: Object.keys(changed).join(','),
      diff: changed,
    });
  return readSettings(db);
}

/** Announcements on air at `now`, oldest first. */
export function activeAnnouncements(db: Db, now = new Date()) {
  return db
    .select()
    .from(announcements)
    .where(
      and(
        isNull(announcements.cancelledAt),
        lte(announcements.startsAt, now),
        gt(announcements.endsAt, now),
      ),
    )
    .orderBy(asc(announcements.startsAt));
}
