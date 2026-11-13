import { campusIndex } from '@campus/map-data/campus';
import {
  ANIM,
  CAMPUS_ROOM,
  type ChannelInfo,
  CLOSE,
  type CorrectMessage,
  decodePosition,
  EMOTES,
  encodePosition,
  healthResponseSchema,
  MSG,
  PLAYER_STATUS,
  type PongMessage,
} from '@campus/shared';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CampusRoom } from './rooms/CampusRoom';
import type { RoomState } from './rooms/state';
import { createServer } from './server';

let colyseus: ColyseusTestServer;
let nextId = 0;
const guest = (name = 'Đồng nghiệp') => ({
  id: `test-user-${String(++nextId).padStart(4, '0')}`,
  name,
});

beforeAll(async () => {
  colyseus = await boot(
    createServer({ devGuestAuth: true, softCap: 2, hardCap: 3, reconnectGraceSeconds: 1 }),
  );
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

/** Joins through automatic channel assignment, like the game does. */
async function join(identity = guest(), extra: Record<string, unknown> = {}) {
  const client = await colyseus.sdk.joinOrCreate<RoomState>(CAMPUS_ROOM, {
    open: true,
    guest: identity,
    ...extra,
  });
  await client.waitForInitialState?.();
  return client;
}

const serverRoom = (client: ClientRoom) => colyseus.getRoomById<CampusRoom>(client.roomId);
const me = (client: ClientRoom<RoomState>) => client.state.players.get(client.sessionId);

/** Sends a move in metres, wire-encoded. */
function move(
  client: ClientRoom,
  seq: number,
  x: number,
  y: number,
  z: number,
  anim: number = ANIM.walk,
) {
  client.send(MSG.move, [seq, encodePosition(x), encodePosition(y), encodePosition(z), 0, anim]);
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

describe('joining', () => {
  it('turns away a client without an identity', async () => {
    await expect(colyseus.sdk.joinOrCreate(CAMPUS_ROOM, { open: true })).rejects.toThrow();
    await expect(
      colyseus.sdk.joinOrCreate(CAMPUS_ROOM, { open: true, guest: { id: 'short', name: 'x' } }),
    ).rejects.toThrow();
  });

  it('places a new player at the main gate and shows them to everyone', async () => {
    const a = await join(guest('An'));
    const b = await join(guest('Bình'));
    await serverRoom(a).waitForNextPatch();
    await settle();
    const seenByA = [...a.state.players.values()].map((p) => p.name).sort();
    expect(seenByA).toEqual(['An', 'Bình']);
    const gate = campusIndex.areas.get('area.gate_main');
    const position = me(b);
    expect(position && gate && decodePosition(position.z)).toBeLessThan(-46);
    expect(position?.status).toBe(PLAYER_STATUS.active);
  });

  it('spreads newcomers over the gate instead of stacking them', async () => {
    const a = await join();
    const b = await join();
    const pa = me(a);
    const pb = me(b);
    if (!pa || !pb) throw new Error('no players');
    const gap = Math.hypot(
      decodePosition(pa.x) - decodePosition(pb.x),
      decodePosition(pa.z) - decodePosition(pb.z),
    );
    expect(gap).toBeGreaterThan(5);
  });

  it('honours a requested spawn point in development', async () => {
    const a = await join(guest(), { spawn: 'poi.checkpoint.atrium' });
    const position = me(a);
    expect(position && decodePosition(position.x)).toBeCloseTo(0, 1);
    expect(position && decodePosition(position.z)).toBeCloseTo(2, 1);
  });
});

describe('movement', () => {
  it('accepts a plausible step and relays it to others', async () => {
    const a = await join();
    const b = await join();
    const start = me(a);
    if (!start) throw new Error('no player');
    const x = decodePosition(start.x);
    const z = decodePosition(start.z);
    await settle(120);
    move(a, 1, x, 0, z + 0.5, ANIM.walk);
    await settle(250);
    const seen = b.state.players.get(a.sessionId);
    expect(seen && decodePosition(seen.z)).toBeCloseTo(z + 0.5, 1);
    expect(seen?.anim).toBe(ANIM.walk);
  });

  it('answers a teleport with a correction and keeps the old position', async () => {
    const a = await join();
    const start = me(a);
    if (!start) throw new Error('no player');
    const correction = a.waitForMessage(MSG.correct) as Promise<CorrectMessage>;
    move(a, 1, 0, 0, 40);
    const message = await correction;
    expect(message.reason).toBe('speed');
    expect(message.z).toBeCloseTo(decodePosition(start.z), 1);
    await settle();
    expect(me(a)?.z).toBe(start.z);
  });

  it('rejects positions outside the world', async () => {
    const a = await join();
    const correction = a.waitForMessage(MSG.correct) as Promise<CorrectMessage>;
    move(a, 1, 0, 0, -95);
    expect((await correction).reason).toBe('bounds');
  });

  it('ignores stale and malformed packets', async () => {
    const a = await join();
    const start = me(a);
    if (!start) throw new Error('no player');
    const x = decodePosition(start.x);
    const z = decodePosition(start.z);
    await settle(200);
    move(a, 5, x, 0, z + 0.4);
    move(a, 4, x, 0, z + 0.1);
    a.send(MSG.move, ['nonsense']);
    a.send(MSG.move, [6, 99999, 0, 0, 0, 0]);
    await settle(250);
    expect(decodePosition(me(a)?.z ?? 0)).toBeCloseTo(z + 0.4, 1);
  });

  it('drops a flood of moves beyond the rate limit', async () => {
    const a = await join();
    const start = me(a);
    if (!start) throw new Error('no player');
    const x = decodePosition(start.x);
    const z = decodePosition(start.z);
    await settle(1100);
    // Forty tiny steps at once: only the first burst of fifteen gets through.
    for (let seq = 1; seq <= 40; seq++) move(a, seq, x, 0, z + seq * 0.01);
    await settle(300);
    expect(decodePosition(me(a)?.z ?? 0)).toBeCloseTo(z + 0.15, 1);
  });

  it('stamps every patch with the room clock and answers pings', async () => {
    const a = await join();
    const first = a.state.time;
    await settle(300);
    expect(a.state.time).toBeGreaterThan(first);
    const pong = a.waitForMessage(MSG.pong) as Promise<PongMessage>;
    a.send(MSG.ping, { t: 123 });
    const answer = await pong;
    expect(answer.t).toBe(123);
    expect(answer.serverTime).toBeGreaterThan(0);
  });
});

describe('channels', () => {
  it('fills the busiest open channel first and opens a new one at the soft cap', async () => {
    const a = await join();
    const b = await join();
    expect(b.roomId).toBe(a.roomId);
    // Soft cap is 2 in this test: the third person gets a new channel.
    const c = await join();
    expect(c.roomId).not.toBe(a.roomId);
    expect(serverRoom(a).state.channel).toBe(1);
    expect(serverRoom(c).state.channel).toBe(2);

    const listing = (await colyseus.http.get('/channels')).data as ChannelInfo[];
    expect(listing.map((ch) => [ch.channel, ch.players, ch.open])).toEqual([
      [1, 2, false],
      [2, 1, true],
    ]);
  });

  it('lets someone join a colleague in a closed channel, up to the hard cap', async () => {
    const a = await join();
    await join();
    const friend = await colyseus.sdk.joinById(a.roomId, { guest: guest() });
    expect(friend.roomId).toBe(a.roomId);
    // Hard cap is 3.
    await expect(colyseus.sdk.joinById(a.roomId, { guest: guest() })).rejects.toThrow();
  });
});

describe('sessions', () => {
  it('closes the older session when the same person joins again', async () => {
    const identity = guest('Hai tab');
    const first = await join(identity);
    const closed = new Promise<number>((resolve) => first.onLeave((code) => resolve(code)));
    const second = await join(identity);
    expect(await closed).toBe(CLOSE.replaced);
    await settle();
    const names = [...second.state.players.values()].filter((p) => p.name === 'Hai tab');
    expect(names).toHaveLength(1);
  });

  it('holds the seat of a dropped player for the grace period, then frees it', async () => {
    const a = await join();
    const b = await join();
    a.reconnection.enabled = false;
    const room = serverRoom(a);
    const dropped = room.clients.find((client) => client.sessionId === a.sessionId);
    dropped?.leave(4010);
    await settle(300);
    expect(b.state.players.get(a.sessionId)?.status).toBe(PLAYER_STATUS.reconnecting);
    await settle(1300);
    expect(b.state.players.has(a.sessionId)).toBe(false);
  });

  it('frees the seat at once when the browser leaves the page', async () => {
    const a = await join();
    const b = await join();
    const dropped = serverRoom(a).clients.find((client) => client.sessionId === a.sessionId);
    dropped?.leave(1001);
    await settle(300);
    expect(b.state.players.has(a.sessionId)).toBe(false);
  });

  it('exposes health in the shared shape', async () => {
    const response = await colyseus.http.get('/health');
    expect(healthResponseSchema.parse(response.data).service).toBe('realtime');
  });
});

describe('emotes and seats', () => {
  it('shows an emote to everyone and counts repeats, but not a flood', async () => {
    const a = await join();
    const b = await join();
    a.send(MSG.emote, { id: EMOTES.wave.id });
    await settle(250);
    const seen = b.state.players.get(a.sessionId);
    expect(seen?.emote).toBe(EMOTES.wave.id);
    const first = seen?.emoteSeq ?? 0;
    // Too soon after the wave: ignored.
    a.send(MSG.emote, { id: EMOTES.bow.id });
    await settle(250);
    expect(b.state.players.get(a.sessionId)?.emote).toBe(EMOTES.wave.id);
    // Two seconds later one more gets through, but only one of a burst; unknown ids never do.
    await settle(1900);
    a.send(MSG.emote, { id: 99 });
    for (let i = 0; i < 5; i++) a.send(MSG.emote, { id: EMOTES.clap.id });
    await settle(250);
    expect(b.state.players.get(a.sessionId)?.emoteSeq).toBe(first + 1);
    expect(b.state.players.get(a.sessionId)?.emote).toBe(EMOTES.clap.id);
  });

  it('seats one person per seat, close enough, and frees it when they walk off', async () => {
    const seat = campusIndex.pois.get('poi.seat.koi_01');
    if (!seat) throw new Error('no seat');
    // Start right at the seat (development spawn), so it is within reach.
    const nearby = seat.id;
    const a = await join(guest('Ngồi'), { spawn: nearby });
    const b = await join(guest('Đứng'), { spawn: nearby });
    const far = await join(guest('Xa'));

    const notice = far.waitForMessage(MSG.notice) as Promise<{ text: string }>;
    far.send(MSG.seatTake, { seatId: seat.id });
    expect((await notice).text).toContain('Lại gần');

    a.send(MSG.seatTake, { seatId: seat.id });
    await settle(250);
    expect(me(a)?.seatId).toBe(seat.id);
    expect(b.state.seats.get(seat.id)).toBe(a.sessionId);

    const taken = b.waitForMessage(MSG.notice) as Promise<{ text: string }>;
    b.send(MSG.seatTake, { seatId: seat.id });
    expect((await taken).text).toContain('đã có người');

    // Walking a few metres away stands them up.
    const start = me(a);
    if (!start) throw new Error('no player');
    let z = decodePosition(start.z);
    const x = decodePosition(start.x);
    for (let seq = 1; seq <= 8; seq++) {
      z -= 0.45;
      move(a, seq, x, 0, z);
      await settle(110);
    }
    await settle(200);
    expect(me(a)?.seatId).toBe('');
    expect(b.state.seats.has(seat.id)).toBe(false);
  });

  it('frees the seat when its occupant leaves', async () => {
    const a = await join(guest(), { spawn: 'poi.seat.koi_01' });
    const b = await join();
    a.send(MSG.seatTake, { seatId: 'poi.seat.koi_01' });
    await settle(250);
    expect(b.state.seats.size).toBe(1);
    await a.leave();
    await settle(250);
    expect(b.state.seats.size).toBe(0);
  });
});
