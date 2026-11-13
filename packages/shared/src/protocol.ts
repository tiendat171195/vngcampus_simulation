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
} as const;

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
export const devGuestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  name: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .refine((name) => !/[<>]/.test(name), 'name must not contain < or >'),
});
export type DevGuest = z.infer<typeof devGuestSchema>;

export const joinOptionsSchema = z.object({
  guest: devGuestSchema.optional(),
  /** Development only: start at this POI instead of the gate. */
  spawn: z.string().max(80).optional(),
  /** Set by automatic channel assignment; see the room's matchmaking filter. */
  open: z.boolean().optional(),
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

export interface ChannelInfo {
  roomId: string;
  channel: number;
  players: number;
  /** Whether automatic assignment still sends new players here. */
  open: boolean;
}
