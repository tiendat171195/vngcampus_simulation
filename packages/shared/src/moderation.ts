import { z } from 'zod';
import type { LeaderboardEntry } from './api';
import type { LocalizedText } from './missions';

/**
 * Reports, analytics and the dashboard (docs/08 §6–7, P5.4). Chat is never stored except the few
 * lines a reporter saw, attached to their report; analytics are counted, never kept per person.
 */

export const REPORT_REASONS = {
  harassment: 'Quấy rối, xúc phạm',
  spam: 'Spam, quảng cáo',
  offensive_name: 'Tên hoặc ngoại hình phản cảm',
  cheating: 'Gian lận',
  other: 'Lý do khác',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Client → realtime (MSG.report): the server attaches the chat lines the reporter saw. */
export const reportSchema = z
  .object({
    targetUserId: z.uuid(),
    reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]),
    note: z.string().trim().max(300).default(''),
  })
  .strict();
export type ReportInput = z.infer<typeof reportSchema>;

/** One chat line attached to a report. */
export interface ReportContextLine {
  at: string;
  name: string;
  text: string;
  /** Said by the person reported / by the reporter. */
  byTarget: boolean;
  byReporter: boolean;
}

export type ReportStatus = 'open' | 'dismissed' | 'warned' | 'muted' | 'banned';

export interface ReportDto {
  id: string;
  reason: ReportReason;
  note: string;
  context: ReportContextLine[];
  status: ReportStatus;
  reporter: { id: string; name: string } | null;
  target: { id: string; name: string; status: 'active' | 'muted' | 'banned' };
  /** Other reports about the same person, any status. */
  targetReports: number;
  resolution: string | null;
  handledByName: string | null;
  handledAt: string | null;
  createdAt: string;
}

export const resolveReportSchema = z
  .object({
    action: z.enum(['dismiss', 'warn', 'mute', 'ban']),
    /** Mute length; a ban without hours lasts until lifted. */
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .nullable()
      .optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type ResolveReport = z.infer<typeof resolveReportSchema>;

// ---------- analytics ----------

/** Buckets for durations and rates, so medians can be read without keeping single values. */
export const LOAD_BUCKETS = ['<2s', '2-5s', '5-10s', '10-20s', '20s+'] as const;
export const FPS_BUCKETS = ['<20', '20-30', '30-45', '45-55', '55+'] as const;
export const SESSION_BUCKETS = ['<5m', '5-15m', '15-30m', '30-60m', '60m+'] as const;

export function bucketOf<T extends string>(
  value: number,
  limits: readonly number[],
  buckets: readonly T[],
): T {
  const index = limits.findIndex((limit) => value < limit);
  return buckets[index === -1 ? buckets.length - 1 : index] as T;
}
export const loadBucket = (ms: number) => bucketOf(ms, [2000, 5000, 10_000, 20_000], LOAD_BUCKETS);
export const fpsBucket = (fps: number) => bucketOf(fps, [20, 30, 45, 55], FPS_BUCKETS);
export const sessionBucket = (ms: number) =>
  bucketOf(
    ms,
    [5, 15, 30, 60].map((m) => m * 60_000),
    SESSION_BUCKETS,
  );

const device = z.enum(['desktop', 'mobile']);
/** What the game reports about itself (POST /analytics); counted into buckets on arrival. */
export const clientEventSchema = z.discriminatedUnion('name', [
  z.object({
    name: z.literal('world_loaded'),
    ms: z.number().int().min(0).max(600_000),
    firstVisit: z.boolean(),
  }),
  z.object({
    name: z.literal('perf_sample'),
    fps: z.number().min(0).max(240),
    device,
    quality: z.enum(['low', 'medium', 'high']),
  }),
  z.object({ name: z.literal('client_error'), code: z.string().regex(/^[A-Za-z0-9_.:-]{1,60}$/) }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export const clientEventsSchema = z.object({ events: z.array(clientEventSchema).min(1).max(20) });

// ---------- dashboard ----------

export interface DayActivity {
  date: string;
  activeUsers: number;
  newUsers: number;
  /** Of that day's users, how many came back the next day; null until the next day is over. */
  returnedNextDay: number | null;
}

export interface DashboardDto {
  date: string;
  today: {
    activeUsers: number;
    newUsers: number;
    sessions: { desktop: number; mobile: number };
    /** The bucket holding the median session, from SESSION_BUCKETS. */
    medianSession: string | null;
    chats: number;
    emotes: number;
    seats: number;
  };
  days: DayActivity[];
  missions: Array<{
    id: string;
    title: LocalizedText;
    kind: string;
    state: string;
    participants: number;
    completions: number;
    medianDurationMs: number | null;
  }>;
  alerts: Array<{ level: 'error' | 'warn' | 'info'; text: string; link?: string }>;
  tech: {
    worldLoad: Record<string, number>;
    fps: Record<string, Record<string, number>>;
    errors: number;
  };
}

export interface MissionResultsDto {
  id: string;
  title: LocalizedText;
  state: string;
  startsAt: string;
  endsAt: string;
  participants: number;
  completions: number;
  medianDurationMs: number | null;
  /** How many players finished each objective: where people give up. */
  objectives: Array<{ id: string; title: LocalizedText; type: string; done: number }>;
  /** Completions per hour, Vietnam time `HH`. */
  byHour: Array<{ hour: string; completions: number }>;
  top: LeaderboardEntry[];
  community: { target: number; completions: number; reached: boolean } | null;
}
