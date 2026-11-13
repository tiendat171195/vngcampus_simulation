/**
 * Realtime protocol shared by the browser and the realtime server (docs/05-multiplayer.md §4).
 * Every message a client sends is validated against these schemas on the server.
 */
import { z } from 'zod';

export const CAMPUS_ROOM = 'campus';

export const MSG = {
  /** Client → server, 10 Hz: `[seq, x, y, z, yaw, anim]` with positions in 1/32 m (see wire.ts). */
  move: 'move',
  /** Client → server: `{ t }`, the client's clock; answered with `pong`. */
  ping: 'ping',
  /** Server → client: `{ t, serverTime }`, for round trip and clock offset. */
  pong: 'pong',
  /** Server → client: a move was rejected; jump back to `{ x, y, z }` (metres). */
  correct: 'correct',
  /** Client → server: `{ id }`, an EMOTES id. Everyone sees it through `emote`/`emoteSeq`. */
  emote: 'emote',
  /** Client → server: `{ seatId }`. Granted through `seatId` in the player's state. */
  seatTake: 'seat:take',
  /** Client → server: `{}`; standing up. Moving away from the seat also frees it. */
  seatLeave: 'seat:leave',
  /** Client → server: `{ text }`. Server → client: ChatMessage, only to people nearby. */
  chat: 'chat',
  /** Client → server: `{ on }`, when the tab is hidden or shown again. */
  afk: 'afk',
  /** Server → client: `{ text }`, a short message for the player (a seat was taken…). */
  notice: 'notice',
  /**
   * Client → server: `{ token }`, a fresh access token after the profile changed (name,
   * avatar). The server reads the new profile from it, so nobody can dress up as someone else.
   */
  profile: 'profile',
  /** Client → server: `{ id }`, use a mission entity (pick up, talk to a kiosk). Within 3 m. */
  interact: 'interact',
  /** Client → server: `{ missionId, objectiveId, questionId, choice }`. */
  quizAnswer: 'quiz:answer',
  /** Server → client: every running mission with this player's progress (MissionStateMessage). */
  missionState: 'mission:state',
  /** Server → client: one objective moved on (MissionProgressMessage). */
  missionProgress: 'mission:progress',
  /** Server → client: mission things this player sees (MissionEntitiesMessage). */
  missionEntities: 'mission:entities',
  /** Server → client: the mission is done and what it earned (MissionCompletedMessage). */
  missionCompleted: 'mission:completed',
  /** Server → client: the question to answer at a kiosk, without the answer (QuizQuestionMessage). */
  quizQuestion: 'quiz:question',
  /** Server → client: whether an answer was right (QuizResultMessage). */
  quizResult: 'quiz:result',
  /** Server → client: `{ text }`, something worth telling everyone in the channel. */
  toast: 'toast',
  /**
   * Server → client: kill switches, maintenance and announcements on air (OpsMessage), on join
   * and whenever they change.
   */
  ops: 'ops',
  /** Client → server: `{ targetUserId, reason, note }` (reportSchema); answered with a notice. */
  report: 'report',
} as const;

/** Emotes, by wire id. Never renumber; add new ones at the end. */
export const EMOTES = {
  wave: { id: 1, label: 'Vẫy tay', seconds: 2.4 },
  clap: { id: 2, label: 'Vỗ tay', seconds: 2.4 },
  bow: { id: 3, label: 'Cúi chào', seconds: 1.8 },
  cheer: { id: 4, label: 'Reo mừng', seconds: 2.4 },
  dance: { id: 5, label: 'Nhảy', seconds: 6 },
  think: { id: 6, label: 'Suy nghĩ', seconds: 3 },
} as const;
export type EmoteName = keyof typeof EMOTES;
export const EMOTE_BY_ID: ReadonlyMap<number, EmoteName> = new Map(
  (Object.keys(EMOTES) as EmoteName[]).map((name) => [EMOTES[name].id, name]),
);

export const emoteSchema = z.object({
  id: z.number().int().min(1).max(Object.keys(EMOTES).length),
});
export const seatTakeSchema = z.object({ seatId: z.string().max(80) });

export const CHAT = {
  /** Messages reach people within this distance of the sender. */
  radius: 12,
  maxLength: 200,
  /** At most this many messages per window. */
  burst: 5,
  windowMs: 10_000,
} as const;

export const chatSchema = z.object({ text: z.string().max(CHAT.maxLength * 2) });

export interface ChatMessage {
  /** Session id of the sender, to place the bubble over the right head. */
  from: string;
  name: string;
  text: string;
  /** Room clock. */
  ts: number;
}

export interface NoticeMessage {
  text: string;
}

export const afkSchema = z.object({ on: z.boolean() });

export const profileSchema = z.object({ token: z.string().min(20).max(4096) });

const int16 = z.number().int().min(-32768).max(32767);

export const moveSchema = z.tuple([
  z
    .number()
    .int()
    .min(0)
    .max(2 ** 32 - 1),
  int16,
  int16,
  int16,
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(31),
]);
export type MovePayload = z.infer<typeof moveSchema>;

export const pingSchema = z.object({ t: z.number() });

export interface PongMessage {
  t: number;
  /** Milliseconds since the room was created, the same clock as `state.time`. */
  serverTime: number;
}

export type CorrectionReason = 'speed' | 'bounds';

export interface CorrectMessage {
  x: number;
  y: number;
  z: number;
  reason: CorrectionReason;
}

/**
 * Identity for development before real sign-in exists (P3). The id is random and kept by the
 * browser; the name is whatever the player typed. Accepted only when the server enables it.
 */
/** A display name: 1–24 characters after trimming, no angle brackets. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .refine((name) => !/[<>]/.test(name), 'name must not contain < or >');

export const devGuestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  name: displayNameSchema,
});
export type DevGuest = z.infer<typeof devGuestSchema>;

export const joinOptionsSchema = z.object({
  /** Access token from the API (docs/07 §5.1). */
  token: z.string().max(4096).optional(),
  guest: devGuestSchema.optional(),
  /** Development only: start at this POI instead of the gate. */
  spawn: z.string().max(80).optional(),
  /** Set by automatic channel assignment; see the room's matchmaking filter. */
  open: z.boolean().optional(),
  /**
   * Where to appear instead of the gate, in metres: used when switching channel so the player
   * keeps their place. Honoured only on walkable ground.
   */
  resume: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  /** Editors only: play this mission (even a draft) alone, without saving or rewards (docs/08 §4.4). */
  preview: z.uuid().optional(),
  /** For counting sessions by device kind; nothing else is derived from it. */
  device: z.enum(['desktop', 'mobile']).optional(),
});
export type JoinOptions = z.infer<typeof joinOptionsSchema>;

/** Close codes of this application, kept clear of Colyseus' own 4000–4010. */
export const CLOSE = {
  /** The same account joined from another tab or device. */
  replaced: 4101,
  /** Removed by a moderator. */
  kicked: 4102,
  /** Idle for too long. */
  idle: 4103,
} as const;

export const PLAYER_STATUS = {
  active: 0,
  afk: 1,
  /** Connection dropped; the seat is held while the client tries to come back. */
  reconnecting: 2,
} as const;

/** One person in the online directory (`GET /rt/online`). */
export interface OnlineEntry {
  userId: string;
  name: string;
  channel: number;
  roomId: string;
  /** Name of the place they are in, if any. */
  area: string;
  status: number;
}

export interface ChannelInfo {
  roomId: string;
  channel: number;
  players: number;
  /** Whether automatic assignment still sends new players here. */
  open: boolean;
}

// ---------- missions (docs/06 §8) ----------

export const interactSchema = z.object({ id: z.string().min(1).max(120) });
export const quizAnswerSchema = z.object({
  missionId: z.string().min(1).max(64),
  objectiveId: z.string().min(1).max(16),
  questionId: z.string().min(1).max(64),
  choice: z.number().int().min(0).max(9),
});

/** Text in the player's language; only Vietnamese is required. */
export interface MissionText {
  vi: string;
  en?: string;
}

export interface ObjectiveView {
  id: string;
  type: string;
  title: MissionText;
  hint?: MissionText;
  current: number;
  target: number;
  done: boolean;
  optional: boolean;
  /** What the objective's presenter needs (targets reached, items picked…); never answers. */
  view: unknown;
}

export interface MissionView {
  id: string;
  kind: string;
  title: MissionText;
  description: MissionText;
  startsAt: string;
  endsAt: string;
  objectiveMode: 'all' | 'sequential' | { anyOf: number };
  objectives: ObjectiveView[];
  /** Points and xp for completing it. */
  rewards: { points: number; xp: number };
  completed: boolean;
  /** An editor trying the mission out: only they see it, nothing is saved. */
  preview?: boolean;
}

export interface MissionStateMessage {
  missions: MissionView[];
}

export interface MissionProgressMessage {
  missionId: string;
  objective: ObjectiveView;
}

/** Something to see or use in the world for a mission. */
export interface MissionEntity {
  id: string;
  missionId: string;
  objectiveId: string;
  kind: 'item' | 'kiosk';
  item?: string;
  /** Feet position, metres. */
  x: number;
  y: number;
  z: number;
}

export interface MissionEntitiesMessage {
  entities: MissionEntity[];
}

export interface MissionCompletedMessage {
  missionId: string;
  title: MissionText;
  points: number;
  xp: number;
  multiplier: number;
  streak: number | null;
  streakBonus: number;
  level: number;
  durationMs: number;
}

export interface QuizQuestionMessage {
  missionId: string;
  objectiveId: string;
  questionId: string;
  text: MissionText;
  choices: MissionText[];
  /** 1-based position in this run, and the run length. */
  index: number;
  total: number;
  triesLeft: number;
}

export interface QuizResultMessage {
  missionId: string;
  objectiveId: string;
  questionId: string;
  correct: boolean;
  explanation?: MissionText;
  /** No more questions in this run. */
  finished: boolean;
}

/** How close a player must be to use a mission entity, in metres. */
export const INTERACT_RANGE = 3;
