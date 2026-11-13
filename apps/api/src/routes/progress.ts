import {
  departmentLeaderboard,
  levelForXp,
  missionLeaderboard,
  periodRange,
  pointsLeaderboard,
} from '@campus/core';
import { missionProgress, missions, userStats } from '@campus/db';
import {
  type CommunityGoalDto,
  type LeaderboardDto,
  type MissionHistoryItem,
  missionDefinitionSchema,
  type StatsDto,
} from '@campus/shared';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ApiError } from '../errors';
import { claimsOf, requireUser } from './guard';

const periodQuery = z.object({ period: z.enum(['week', 'month', 'all']).default('week') });
const idParams = z.object({ id: z.uuid() });

/** Xp at which a level starts: 50·n·(n−1). */
const levelStart = (level: number) => 50 * level * (level - 1);

/** Stats, history and leaderboards (docs/07 §4). Progress itself is only written by realtime. */
export async function progressRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db } = deps;
  const guard = { preHandler: requireUser(deps.keys) };
  // In `limited` guest mode guests play but stay off the leaderboards (docs/07 §5.2).
  const guests = deps.guestMode !== 'limited';

  app.get('/me/stats', guard, async (request): Promise<StatsDto> => {
    const [row] = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, claimsOf(request).sub));
    const xp = row?.xp ?? 0;
    const level = levelForXp(xp);
    return {
      points: row?.points ?? 0,
      xp,
      level,
      levelFrom: levelStart(level),
      levelTo: levelStart(level + 1),
      streakCurrent: row?.streakCurrent ?? 0,
      streakBest: row?.streakBest ?? 0,
      missionsCompleted: row?.missionsCompleted ?? 0,
    };
  });

  app.get('/missions/history', guard, async (request): Promise<MissionHistoryItem[]> => {
    const rows = await db
      .select({ progress: missionProgress, mission: missions })
      .from(missionProgress)
      .innerJoin(missions, eq(missions.id, missionProgress.missionId))
      .where(
        and(
          eq(missionProgress.userId, claimsOf(request).sub),
          eq(missionProgress.isPreview, false),
        ),
      )
      .orderBy(desc(missionProgress.startedAt))
      .limit(30);
    return rows.map(({ progress, mission }) => ({
      missionId: mission.id,
      kind: mission.kind,
      title: mission.title as MissionHistoryItem['title'],
      startedAt: progress.startedAt.toISOString(),
      completedAt: progress.completedAt?.toISOString() ?? null,
      durationMs: progress.durationMs,
      rank: progress.rank,
    }));
  });

  app.get('/leaderboards/points', guard, async (request): Promise<LeaderboardDto> => {
    const parsed = periodQuery.safeParse(request.query ?? {});
    if (!parsed.success)
      throw new ApiError(400, 'invalid_request', 'Kỳ xếp hạng là week, month hoặc all.');
    const { period } = parsed.data;
    const range = periodRange(period, new Date());
    const board = await pointsLeaderboard(db, {
      start: range.start,
      me: claimsOf(request).sub,
      guests,
    });
    return { board: 'points', period: range.key, ...board };
  });

  app.get('/leaderboards/departments', guard, async (): Promise<LeaderboardDto> => {
    const range = periodRange('week', new Date());
    const rows = await departmentLeaderboard(db, { start: range.start });
    return { board: 'departments', period: range.key, rows, me: null };
  });

  app.get('/leaderboards/mission/:id', guard, async (request): Promise<LeaderboardDto> => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) throw new ApiError(404, 'not_found', 'Không có nhiệm vụ này.');
    const board = await missionLeaderboard(db, {
      missionId: parsed.data.id,
      me: claimsOf(request).sub,
    });
    return { board: 'mission', period: parsed.data.id, ...board };
  });

  app.get('/missions/:id/community', guard, async (request): Promise<CommunityGoalDto> => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) throw new ApiError(404, 'not_found', 'Không có nhiệm vụ này.');
    const [mission] = await db.select().from(missions).where(eq(missions.id, parsed.data.id));
    if (mission?.publishStatus !== 'published')
      throw new ApiError(404, 'not_found', 'Không có nhiệm vụ này.');
    const goal = missionDefinitionSchema.safeParse(mission.definition);
    const [count] = await db
      .select({ completions: sql<number>`count(*)::int` })
      .from(missionProgress)
      .where(
        and(
          eq(missionProgress.missionId, mission.id),
          isNotNull(missionProgress.completedAt),
          eq(missionProgress.isPreview, false),
        ),
      );
    return {
      completions: count?.completions ?? 0,
      target: goal.success ? (goal.data.communityGoal?.target ?? null) : null,
    };
  });
}
