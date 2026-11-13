import type { Db } from '@campus/db';
import { sql } from 'drizzle-orm';
import { vnDateOf, vnDayBounds } from '../time';

export type PointsPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  rank: number;
  /** User id, or department id for the department board. */
  id: string;
  name: string;
  score: number;
  /** Department board: people who scored this week. */
  members?: number;
}

export interface Leaderboard {
  /** Stable name of the board and period, e.g. `points:week:2026-11-09`. */
  key: string;
  rows: LeaderboardRow[];
  /** The asking person's own line, when they are on the board but below the top rows. */
  me: LeaderboardRow | null;
}

const DAY_MS = 86_400_000;

/**
 * The time range of a period on the Vietnam calendar: weeks start on Monday 00:00, months on
 * the 1st. `end` is exclusive; `all` has no start.
 */
export function periodRange(
  period: PointsPeriod,
  now: Date,
): { key: string; start: Date; end: Date | null } {
  const today = vnDateOf(now);
  if (period === 'all') return { key: 'all', start: new Date(0), end: null };
  if (period === 'month') {
    const first = `${today.slice(0, 7)}-01`;
    return { key: today.slice(0, 7), start: vnDayBounds(first).start, end: null };
  }
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((weekday + 6) % 7) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { key: monday, start: vnDayBounds(monday).start, end: null };
}

/** The period before the one `now` falls in, for end-of-period snapshots. */
export function previousPeriod(period: 'week' | 'month', now: Date) {
  const current = periodRange(period, now);
  const before = periodRange(period, new Date(current.start.getTime() - 1));
  return { key: before.key, start: before.start, end: current.start };
}

type Row = Record<string, unknown>;
const toRow = (row: Row): LeaderboardRow => ({
  rank: Number(row.rank),
  id: String(row.id),
  name: String(row.name),
  score: Number(row.score),
  ...(row.members !== undefined ? { members: Number(row.members) } : {}),
});

function split(rows: Row[], limit: number, me: string | null) {
  const all = rows.map(toRow);
  const top = all.filter((row) => row.rank <= limit);
  const mine = me ? (all.find((row) => row.id === me) ?? null) : null;
  return { rows: top, me: mine && mine.rank > limit ? mine : null };
}

/** People by points earned in a period (docs/06 §7). Guests can be left out (GUEST_MODE). */
export async function pointsLeaderboard(
  db: Db,
  input: { start: Date; end?: Date | null; limit?: number; me?: string | null; guests?: boolean },
): Promise<Pick<Leaderboard, 'rows' | 'me'>> {
  const limit = input.limit ?? 50;
  const end = input.end ?? new Date('9999-01-01T00:00:00Z');
  const rows = await db.execute(sql`
    with scores as (
      select l.user_id, sum(l.delta)::int as score
      from wallet_ledger l
      join users u on u.id = l.user_id
      where l.currency = 'points'
        and l.created_at >= ${input.start.toISOString()}::timestamptz
        and l.created_at < ${end.toISOString()}::timestamptz
        and u.status <> 'banned'
        and (${input.guests ?? true} or not u.is_guest)
      group by l.user_id
    ), ranked as (
      select user_id, score, rank() over (order by score desc)::int as rank from scores
    )
    select r.user_id as id, r.score, r.rank, u.display_name as name
    from ranked r join users u on u.id = r.user_id
    where r.rank <= ${limit} or r.user_id::text = ${input.me ?? ''}
    order by r.rank, u.display_name`);
  return split(rows as unknown as Row[], limit, input.me ?? null);
}

/** Who finished a mission fastest, counted from their own start (docs/06 §7). */
export async function missionLeaderboard(
  db: Db,
  input: { missionId: string; limit?: number; me?: string | null },
): Promise<Pick<Leaderboard, 'rows' | 'me'>> {
  const limit = input.limit ?? 50;
  const rows = await db.execute(sql`
    with ranked as (
      select user_id, duration_ms as score,
        rank() over (order by duration_ms asc, completed_at asc)::int as rank
      from mission_progress
      where mission_id = ${input.missionId} and completed_at is not null and not is_preview
    )
    select r.user_id as id, r.score, r.rank, u.display_name as name
    from ranked r join users u on u.id = r.user_id
    where (r.rank <= ${limit} or r.user_id::text = ${input.me ?? ''}) and u.status <> 'banned'
    order by r.rank`);
  return split(rows as unknown as Row[], limit, input.me ?? null);
}

/**
 * Departments by average points per person who scored, so small departments are not behind
 * (docs/06 §7).
 */
export async function departmentLeaderboard(
  db: Db,
  input: { start: Date; end?: Date | null; limit?: number },
): Promise<LeaderboardRow[]> {
  const end = input.end ?? new Date('9999-01-01T00:00:00Z');
  const rows = await db.execute(sql`
    with scores as (
      select user_id, sum(delta)::int as score
      from wallet_ledger
      where currency = 'points'
        and created_at >= ${input.start.toISOString()}::timestamptz
        and created_at < ${end.toISOString()}::timestamptz
      group by user_id
    )
    select d.id, d.name, round(avg(s.score))::int as score, count(*)::int as members,
      rank() over (order by avg(s.score) desc)::int as rank
    from scores s
    join users u on u.id = s.user_id
    join departments d on d.id = u.department_id
    where u.status <> 'banned'
    group by d.id, d.name
    order by rank, d.name
    limit ${input.limit ?? 50}`);
  return (rows as unknown as Row[]).map(toRow);
}
