import { type Db, reports, users, uuidv7 } from '@campus/db';
import type { ReportContextLine, ReportDto, ReportReason, ResolveReport } from '@campus/shared';
import { and, desc, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { applySanction, audit } from './sanctions';

/** A warning shows to the person once and stays on their record this long. */
export const WARN_HOURS = 24;
/** Chat attached to a report is cleared this long after it was decided (docs/09 §6). */
export const REPORT_CONTEXT_DAYS = 180;

/**
 * Files a report (docs/08 §6). A second report from the same person about the same person while
 * the first is still open only refreshes it, so pressing twice does not double the queue.
 */
export async function createReport(
  db: Db,
  input: {
    reporterId: string;
    targetUserId: string;
    reason: ReportReason;
    note: string;
    context: ReportContextLine[];
  },
): Promise<{ id: string; created: boolean } | null> {
  if (input.reporterId === input.targetUserId) return null;
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.targetUserId));
  if (!target) return null;
  const [open] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterId, input.reporterId),
        eq(reports.targetUserId, input.targetUserId),
        eq(reports.status, 'open'),
      ),
    );
  if (open) {
    await db
      .update(reports)
      .set({ reason: input.reason, note: input.note, context: input.context })
      .where(eq(reports.id, open.id));
    return { id: open.id, created: false };
  }
  const id = uuidv7();
  await db.insert(reports).values({ id, ...input });
  return { id, created: true };
}

const STATUS_OF = {
  dismiss: 'dismissed',
  warn: 'warned',
  mute: 'muted',
  ban: 'banned',
} as const;

/**
 * Decides a report: dismiss, warn, mute or ban (docs/08 §6). The sanction is applied once, and
 * every other open report about the same person is closed with the same decision.
 */
export async function resolveReport(
  db: Db,
  input: ResolveReport & { reportId: string; actorId: string },
): Promise<{ status: ReportDto['status']; closed: number } | null> {
  const [report] = await db.select().from(reports).where(eq(reports.id, input.reportId));
  if (report?.status !== 'open') return null;
  const resolution = input.note?.trim() || null;
  if (input.action !== 'dismiss') {
    const hours =
      input.action === 'warn'
        ? WARN_HOURS
        : input.action === 'mute'
          ? (input.hours ?? 1)
          : (input.hours ?? null);
    await applySanction(db, {
      userId: report.targetUserId,
      type: input.action,
      reason: resolution ?? `Báo cáo: ${report.reason}`,
      hours,
      actorId: input.actorId,
    });
  }
  const status = STATUS_OF[input.action];
  const closed = await db
    .update(reports)
    .set({ status, resolution, handledBy: input.actorId, handledAt: new Date() })
    .where(
      input.action === 'dismiss'
        ? eq(reports.id, report.id)
        : and(eq(reports.targetUserId, report.targetUserId), eq(reports.status, 'open')),
    )
    .returning({ id: reports.id });
  await audit(db, {
    actorId: input.actorId,
    action: 'report.resolve',
    entityType: 'report',
    entityId: report.id,
    diff: { action: input.action, hours: input.hours ?? null, closed: closed.length },
  });
  return { status, closed: closed.length };
}

/** The moderation queue: open reports oldest first, or recent decisions newest first. */
export async function listReports(
  db: Db,
  input: { status: 'open' | 'handled'; limit?: number },
): Promise<ReportDto[]> {
  const reporter = alias(users, 'reporter');
  const target = alias(users, 'target');
  const handler = alias(users, 'handler');
  const rows = await db
    .select({
      report: reports,
      reporterName: reporter.displayName,
      targetName: target.displayName,
      targetStatus: target.status,
      handlerName: handler.displayName,
    })
    .from(reports)
    .innerJoin(target, eq(target.id, reports.targetUserId))
    .leftJoin(reporter, eq(reporter.id, reports.reporterId))
    .leftJoin(handler, eq(handler.id, reports.handledBy))
    .where(input.status === 'open' ? eq(reports.status, 'open') : sql`${reports.status} <> 'open'`)
    .orderBy(input.status === 'open' ? reports.createdAt : desc(reports.handledAt))
    .limit(input.limit ?? 100);
  const targets = [...new Set(rows.map((row) => row.report.targetUserId))];
  const counts = new Map<string, number>();
  if (targets.length > 0) {
    const tallies = await db
      .select({ id: reports.targetUserId, n: sql<number>`count(*)::int` })
      .from(reports)
      .where(inArray(reports.targetUserId, targets))
      .groupBy(reports.targetUserId);
    for (const tally of tallies) counts.set(tally.id, tally.n);
  }
  return rows.map(({ report, reporterName, targetName, targetStatus, handlerName }) => ({
    id: report.id,
    reason: report.reason,
    note: report.note,
    context: report.context as ReportContextLine[],
    status: report.status,
    reporter: report.reporterId ? { id: report.reporterId, name: reporterName ?? '—' } : null,
    target: { id: report.targetUserId, name: targetName, status: targetStatus },
    targetReports: (counts.get(report.targetUserId) ?? 1) - 1,
    resolution: report.resolution,
    handledByName: handlerName,
    handledAt: report.handledAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
  }));
}

export async function openReportCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reports)
    .where(eq(reports.status, 'open'));
  return row?.n ?? 0;
}

/** Clears the chat kept with reports decided long ago; the decision itself stays. */
export async function pruneReportContext(db: Db, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - REPORT_CONTEXT_DAYS * 86_400_000);
  const cleared = await db
    .update(reports)
    .set({ context: [] })
    .where(
      and(
        isNotNull(reports.handledAt),
        lt(reports.handledAt, before),
        gt(sql`jsonb_array_length(${reports.context})`, 0),
      ),
    )
    .returning({ id: reports.id });
  return cleared.length;
}
