import { type SchemaType, schema, t } from '@colyseus/schema';

/**
 * Room state (docs/05-multiplayer.md §3). Positions are int16 in 1/32 m and yaw one byte, as
 * encoded by `@campus/shared/wire`; every client decodes the same numbers.
 */
export const PlayerState = schema(
  {
    userId: t.string().default(''),
    name: t.string().default(''),
    /** Avatar configuration string (P3.3). */
    avatar: t.string().default(''),
    /** Department label, optional. */
    tag: t.string().default(''),
    level: t.uint8().default(1),
    /** See PLAYER_STATUS. */
    status: t.uint8().default(0),
    x: t.int16().default(0),
    y: t.int16().default(0),
    z: t.int16().default(0),
    yaw: t.uint8().default(0),
    /** See ANIM. */
    anim: t.uint8().default(0),
    emote: t.uint8().default(0),
    emoteSeq: t.uint16().default(0),
    seatId: t.string().default(''),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const RoomState = schema(
  {
    /** Channel number shown to players ("Campus 2"). */
    channel: t.uint16().default(1),
    /** Milliseconds since the room was created, stamped on every patch; clients interpolate on it. */
    time: t.uint32().default(0),
    players: t.map(PlayerState),
  },
  'RoomState',
);
export type RoomState = SchemaType<typeof RoomState>;
