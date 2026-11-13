import {
  activityDays,
  analyticsDaily,
  type Db,
  missionProgress,
  missions,
  users,
} from '@campus/db';
import {
  type DashboardDto,
  type LocalizedText,
  type MissionResultsDto,
  missionDefinitionSchema,
  SESSION_BUCKETS,
} from '@campus/shared';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { missionLeaderboard } from '../missions/leaderboards';
import { openReportCount } from '../moderation/reports';
import { readSettings } from '../operations/settings';
import { vnDateOf, vnDayBounds } from '../time';

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function missionState(row: { publishStatus: string; startsAt: Date; endsAt: Date }, now: Date) {
  if (row.publishStatus !== 'published') return row.publishStatus;
  if (now < row.startsAt) return 'scheduled';
  return now < row.endsAt ? 'running' : 'ended';
}

/** Participants, completions and the median time of some missions, previews left out. */
async function missionNumbers(db: Db, ids: string[]) {
  if (ids.length === 0)
    return new Map<string, { participants: number; completions: number; median: number | null }>();
  const rows = await db
    .select({
      id: missionProgress.missionId,
      participants: sql<number>`count(*)::int`,
      completions: sql<number>`count(${missionProgress.completedAt})::int`,
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${missionProgress.durationMs})`,
    })
    .from(missionProgress)
    .where(and(inArray(missionProgress.missionId, ids), eq(missionProgress.isPreview, false)))
    .groupBy(missionProgress.missionId);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        participants: row.participants,
        completions: row.completions,
        median: row.median === null ? null : Math.round(Number(row.median)),
      },
    ]),
  );
}

/** The bucket holding the middle value of a histogram. */
function medianBucket(counts: Map<string, number>, buckets: readonly string[]): string | null {
  const total = buckets.reduce((sum, bucket) => sum + (counts.get(bucket) ?? 0), 0);
  if (total === 0) return null;
  let seen = 0;
  for (const bucket of buckets) {
    seen += counts.get(bucket) ?? 0;
    if (seen * 2 >= total) return bucket;
  }
  return null;
}

/**
 * Everything the admin's front page shows (docs/08 §7), all of it counts: today's activity, the
 * last week, today's missions, things that need someone, and how the game runs.
 */
export async function dashboardOverview(
  db: Db,
  now = new Date(),
  options: { canModerate: boolean } = { canModerate: false },
): Promise<DashboardDto> {
  const today = vnDateOf(now);
  const first = addDays(today, -6);
  const { start: weekStart } = vnDayBounds(first);
  const { start: todayStart, end: todayEnd } = vnDayBounds(today);

  const counters = await db.select().from(analyticsDaily).where(eq(analyticsDaily.day, today));
  const count = (metric: string, dimension?: string) =>
    counters
      .filter(
        (row) => row.metric === metric && (dimension === undefined || row.dimension === dimension),
      )
      .reduce((sum, row) => sum + row.value, 0);
  const histogram = (metric: string) =>
    new Map(
      counters.filter((row) => row.metric === metric).map((row) => [row.dimension, row.value]),
    );

  // The last seven days, with who came back the day after.
  const active = await db
    .select({ day: activityDays.day, n: sql<number>`count(*)::int` })
    .from(activityDays)
    .where(gte(activityDays.day, first))
    .groupBy(activityDays.day);
  const returned = await db.execute(sql`
    select a.day::text as day, count(*)::int as n
    from activity_days a join activity_days b
      on b.user_hash = a.user_hash and b.day = a.day + 1
    where a.day >= ${first}::date
    group by a.day`);
  const joined = await db
    .select({
      day: sql<string>`to_char(${users.createdAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(and(gte(users.createdAt, weekStart), lt(users.createdAt, todayEnd)))
    .groupBy(sql`1`);
  const activeOn = new Map(active.map((row) => [row.day, row.n]));
  const returnedOn = new Map(
    (returned as unknown as Array<{ day: string; n: number }>).map((row) => [row.day, row.n]),
  );
  const joinedOn = new Map(joined.map((row) => [row.day, row.n]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i)).map((date) => ({
    date,
    activeUsers: activeOn.get(date) ?? 0,
    newUsers: joinedOn.get(date) ?? 0,
    returnedNextDay: date >= today ? null : (returnedOn.get(date) ?? 0),
  }));

  // Missions running at some point today.
  const todays = await db
    .select()
    .from(missions)
    .where(
      and(
        eq(missions.publishStatus, 'published'),
        lt(missions.startsAt, todayEnd),
        sql`${missions.endsAt} > ${todayStart.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(missions.startsAt);
  const numbers = await missionNumbers(
    db,
    todays.map((row) => row.id),
  );

  // What needs someone.
  const alerts: DashboardDto['alerts'] = [];
  const settings = await readSettings(db);
  if (settings.maintenance.on)
    alerts.push({ level: 'error', text: 'Đang bật chế độ bảo trì.', link: '/settings' });
  if (!settings.chatEnabled)
    alerts.push({ level: 'warn', text: 'Chat đang tắt trên toàn campus.', link: '/settings' });
  const tomorrow = addDays(today, 1);
  const dailies = await db
    .select({
      id: missions.id,
      day: missions.dailyDate,
      autoFilled: missions.autoFilled,
      title: missions.title,
    })
    .from(missions)
    .where(
      and(
        eq(missions.kind, 'daily'),
        eq(missions.publishStatus, 'published'),
        inArray(missions.dailyDate, [today, tomorrow]),
      ),
    );
  if (!dailies.some((row) => row.day === today))
    alerts.push({
      level: 'warn',
      text: 'Hôm nay không có nhiệm vụ ngày.',
      link: `/missions/new?date=${today}`,
    });
  const next = dailies.find((row) => row.day === tomorrow);
  if (!next)
    alerts.push({
      level: 'warn',
      text: settings.autofill.enabled
        ? `Ngày mai (${tomorrow}) chưa có nhiệm vụ ngày — 23:00 sẽ tự điền từ mẫu nếu còn mẫu dùng được.`
        : `Ngày mai (${tomorrow}) chưa có nhiệm vụ ngày và tự điền đang tắt.`,
      link: `/missions/new?date=${tomorrow}`,
    });
  else if (next.autoFilled)
    alerts.push({
      level: 'info',
      text: `Ngày mai được tự điền từ mẫu: "${(next.title as LocalizedText).vi}". Xem lại nếu cần.`,
      link: `/missions/${next.id}`,
    });
  if (options.canModerate) {
    const open = await openReportCount(db);
    if (open > 0)
      alerts.push({ level: 'warn', text: `${open} báo cáo vi phạm chờ xử lý.`, link: '/reports' });
  }

  const fps: Record<string, Record<string, number>> = {};
  for (const device of ['desktop', 'mobile'])
    fps[device] = Object.fromEntries(histogram(`fps_${device}`));
  const worldLoad: Record<string, number> = {};
  for (const metric of ['world_loaded', 'world_loaded_first'])
    for (const [bucket, value] of histogram(metric))
      worldLoad[bucket] = (worldLoad[bucket] ?? 0) + value;

  return {
    date: today,
    today: {
      activeUsers: activeOn.get(today) ?? 0,
      newUsers: joinedOn.get(today) ?? 0,
      sessions: {
        desktop: count('session_start', 'desktop'),
        mobile: count('session_start', 'mobile'),
      },
      medianSession: medianBucket(histogram('session_length'), SESSION_BUCKETS),
      chats: count('chat_sent'),
      emotes: count('emote_used'),
      seats: count('seat_taken'),
    },
    days,
    missions: todays.map((row) => ({
      id: row.id,
      title: row.title as LocalizedText,
      kind: row.kind,
      state: missionState(row, now),
      participants: numbers.get(row.id)?.participants ?? 0,
      completions: numbers.get(row.id)?.completions ?? 0,
      medianDurationMs: numbers.get(row.id)?.median ?? null,
    })),
    alerts,
    tech: { worldLoad, fps, errors: count('client_error') },
  };
}

/** One mission's results page (docs/08 §3): the funnel, where people stop, when they finish. */
export async function missionResults(
  db: Db,
  missionId: string,
  now = new Date(),
): Promise<MissionResultsDto | null> {
  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId));
  if (!mission) return null;
  const parsed = missionDefinitionSchema.safeParse(mission.definition);
  const numbers = (await missionNumbers(db, [missionId])).get(missionId);
  const objectives = [];
  for (const objective of parsed.success ? parsed.data.objectives : []) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(missionProgress)
      .where(
        and(
          eq(missionProgress.missionId, missionId),
          eq(missionProgress.isPreview, false),
          sql`(${missionProgress.state} -> ${objective.id} ->> 'done') = 'true'`,
        ),
      );
    objectives.push({
      id: objective.id,
      title: objective.title,
      type: objective.type,
      done: row?.n ?? 0,
    });
  }
  const hours = await db
    .select({
      hour: sql<string>`to_char(${missionProgress.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'HH24')`,
      n: sql<number>`count(*)::int`,
    })
    .from(missionProgress)
    .where(
      and(
        eq(missionProgress.missionId, missionId),
        eq(missionProgress.isPreview, false),
        sql`${missionProgress.completedAt} is not null`,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const { rows: top } = await missionLeaderboard(db, { missionId, limit: 10 });
  const goal = parsed.success ? parsed.data.communityGoal : undefined;
  const completions = numbers?.completions ?? 0;
  return {
    id: mission.id,
    title: mission.title as LocalizedText,
    state: missionState(mission, now),
    startsAt: mission.startsAt.toISOString(),
    endsAt: mission.endsAt.toISOString(),
    participants: numbers?.participants ?? 0,
    completions,
    medianDurationMs: numbers?.median ?? null,
    objectives,
    byHour: hours.map((row) => ({ hour: row.hour, completions: row.n })),
    top,
    community: goal
      ? { target: goal.target, completions, reached: completions >= goal.target }
      : null,
  };
}
