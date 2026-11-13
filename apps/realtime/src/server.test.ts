import { campusIndex } from '@campus/map-data/campus';
import {
  ANIM,
  CAMPUS_ROOM,
  type ChannelInfo,
  type ChatMessage,
  CLOSE,
  type CorrectMessage,
  decodePosition,
  EMOTES,
  encodePosition,
  healthResponseSchema,
  MSG,
  type OnlineEntry,
  PLAYER_STATUS,
  type PongMessage,
} from '@campus/shared';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTokenVerifier } from './auth';
import type { CampusRoom } from './rooms/CampusRoom';
import type { RoomState } from './rooms/state';
import { createServer } from './server';

let colyseus: ColyseusTestServer;
/** Signs tokens the way the API does, with a key only this test knows. */
let signToken: (
  claims: { sub: string; name: string; guest?: boolean; avatar?: string; hidden?: boolean },
  issuer?: string,
) => Promise<string>;
let nextId = 0;
const guest = (name = 'Đồng nghiệp') => ({
  id: `test-user-${String(++nextId).padStart(4, '0')}`,
  name,
});

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }],
  });
  signToken = (claims, issuer = 'campus-api') =>
    new SignJWT({
      name: claims.name,
      role: 'player',
      guest: claims.guest ?? false,
      avatar: claims.avatar ?? '',
      hidden: claims.hidden ?? false,
      sid: 's',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(claims.sub)
      .setIssuer(issuer)
      .setAudience('campus')
      .setExpirationTime('5m')
      .sign(privateKey);
  colyseus = await boot(
    createServer({
      devGuestAuth: true,
      verifyToken: createTokenVerifier(jwks),
      softCap: 2,
      hardCap: 3,
      reconnectGraceSeconds: 1,
      idleAfkSeconds: 2,
      idleKickSeconds: 6,
    }),
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

describe('chat', () => {
  it('reaches people nearby, cleaned and filtered, but not people far away', async () => {
    const speaker = await join(guest('Nói'), { spawn: 'poi.checkpoint.atrium' });
    const neighbour = await join(guest('Gần'), { spawn: 'poi.checkpoint.atrium' });
    const stranger = await join(guest('Xa'));

    const heard = neighbour.waitForMessage(MSG.chat) as Promise<ChatMessage>;
    const echoed = speaker.waitForMessage(MSG.chat) as Promise<ChatMessage>;
    let strangerHeard = false;
    stranger.onMessage(MSG.chat, () => {
      strangerHeard = true;
    });
    speaker.send(MSG.chat, { text: '  đm   trưa nay ăn gì?  ' });

    const message = await heard;
    expect(message).toMatchObject({
      from: speaker.sessionId,
      name: 'Nói',
      text: '** trưa nay ăn gì?',
    });
    expect((await echoed).text).toBe(message.text);
    await settle(200);
    expect(strangerHeard).toBe(false);
  });

  it('ignores empty lines and slows down a flood', async () => {
    const a = await join(guest(), { spawn: 'poi.checkpoint.atrium' });
    const b = await join(guest(), { spawn: 'poi.checkpoint.atrium' });
    const received: string[] = [];
    b.onMessage(MSG.chat, (message: ChatMessage) => received.push(message.text));
    const warned = a.waitForMessage(MSG.notice) as Promise<{ text: string }>;
    a.send(MSG.chat, { text: '   ' });
    for (let i = 1; i <= 8; i++) a.send(MSG.chat, { text: `tin ${i}` });
    expect((await warned).text).toContain('hơi nhanh');
    await settle(250);
    expect(received).toEqual(['tin 1', 'tin 2', 'tin 3', 'tin 4', 'tin 5']);
  });
});

describe('presence', () => {
  it('shows a hidden tab as away and back', async () => {
    const a = await join();
    const b = await join();
    a.send(MSG.afk, { on: true });
    await settle(250);
    expect(b.state.players.get(a.sessionId)?.status).toBe(PLAYER_STATUS.afk);
    a.send(MSG.afk, { on: false });
    await settle(250);
    expect(b.state.players.get(a.sessionId)?.status).toBe(PLAYER_STATUS.active);
  });

  it('marks an idle player away, then asks them to leave', { timeout: 12_000 }, async () => {
    const idle = await join();
    const watcher = await join();
    const closed = new Promise<number>((resolve) => idle.onLeave((code) => resolve(code)));
    // Away after 2 s, checked once a second, plus a patch on the way.
    await settle(3400);
    expect(watcher.state.players.get(idle.sessionId)?.status).toBe(PLAYER_STATUS.afk);
    expect(await closed).toBe(CLOSE.idle);
  });

  it('lists who is online, where, and finds names without diacritics', async () => {
    await join(guest('Bình'), { spawn: 'poi.checkpoint.atrium' });
    const an = await join(guest('An'));
    await settle(1200);
    const everyone = (await colyseus.http.get('/online')).data as OnlineEntry[];
    expect(everyone.map((entry) => [entry.name, entry.channel, entry.area])).toEqual([
      ['An', 1, 'Cổng chính'],
      ['Bình', 1, 'Atrium'],
    ]);
    const found = (await colyseus.http.get('/online?q=binh')).data as OnlineEntry[];
    expect(found.map((entry) => entry.name)).toEqual(['Bình']);

    await an.leave();
    await settle(300);
    const after = (await colyseus.http.get('/online')).data as OnlineEntry[];
    expect(after.map((entry) => entry.name)).toEqual(['Bình']);
  });

  it("keeps one's place when switching channel, but only on walkable ground", async () => {
    const mover = await join(guest(), { resume: { x: 10, y: 0, z: -20 } });
    expect(decodePosition(me(mover)?.x ?? 0)).toBeCloseTo(10, 1);
    expect(decodePosition(me(mover)?.z ?? 0)).toBeCloseTo(-20, 1);
    const swimmer = await join(guest(), { resume: { x: -2, y: 0, z: 30 } });
    expect(decodePosition(me(swimmer)?.z ?? 0)).toBeLessThan(-45);
  });
});

describe('access tokens', () => {
  it('lets a signed-in user join under their account name', async () => {
    const token = await signToken({ sub: '0190f0c2-0000-7000-8000-000000000001', name: 'Từ API' });
    const room = await colyseus.sdk.joinOrCreate<RoomState>(CAMPUS_ROOM, { open: true, token });
    await settle(150);
    expect(me(room)).toMatchObject({
      name: 'Từ API',
      userId: '0190f0c2-0000-7000-8000-000000000001',
      tag: '',
    });
  });

  it('labels guests as guests', async () => {
    const token = await signToken({
      sub: '0190f0c2-0000-7000-8000-000000000002',
      name: 'Vãng Lai',
      guest: true,
    });
    const room = await colyseus.sdk.joinOrCreate<RoomState>(CAMPUS_ROOM, { open: true, token });
    await settle(150);
    expect(me(room)).toMatchObject({ name: 'Vãng Lai', tag: 'Khách' });
  });

  it('changes name and avatar mid-visit, only with a token for the same person', async () => {
    const sub = '0190f0c2-0000-7000-8000-000000000003';
    const first = 'v1.b1.s1.h1-1.t0-0.p0-8.f0-5.a0';
    const room = await colyseus.sdk.joinOrCreate<RoomState>(CAMPUS_ROOM, {
      open: true,
      token: await signToken({ sub, name: 'Thay Đồ', guest: true, avatar: first }),
    });
    await settle(150);
    expect(me(room)).toMatchObject({ avatar: first, tag: 'Khách' });

    const second = 'v1.b2.s5.h8-3.t2-7.p1-2.f2-9.a5';
    room.send(MSG.profile, {
      token: await signToken({ sub, name: 'Đã Thay Đồ', avatar: second }),
    });
    await settle(200);
    expect(me(room)).toMatchObject({ name: 'Đã Thay Đồ', avatar: second, tag: '' });

    // Someone else's token, or an avatar the codec does not know, changes nothing.
    room.send(MSG.profile, {
      token: await signToken({ sub: 'other', name: 'Kẻ Khác', avatar: first }),
    });
    room.send(MSG.profile, {
      token: await signToken({ sub, name: 'Đã Thay Đồ', avatar: '<b>' }),
    });
    await settle(200);
    expect(me(room)).toMatchObject({ name: 'Đã Thay Đồ' });
    expect(me(room)?.avatar).not.toBe(first);
  });

  it('keeps people who asked for it out of the online list, and back in when they change their mind', async () => {
    const sub = '0190f0c2-0000-7000-8000-000000000004';
    const names = async () =>
      ((await colyseus.http.get('/online?q=kin dao')).data as OnlineEntry[]).map((e) => e.name);
    const room = await colyseus.sdk.joinOrCreate<RoomState>(CAMPUS_ROOM, {
      open: true,
      token: await signToken({ sub, name: 'Kín Đáo', hidden: true }),
    });
    await settle(300);
    expect(me(room)?.name).toBe('Kín Đáo');
    expect(await names()).toEqual([]);

    room.send(MSG.profile, { token: await signToken({ sub, name: 'Kín Đáo', hidden: false }) });
    await settle(300);
    expect(await names()).toEqual(['Kín Đáo']);

    room.send(MSG.profile, { token: await signToken({ sub, name: 'Kín Đáo', hidden: true }) });
    await settle(300);
    expect(await names()).toEqual([]);
  });

  it('turns away forged or foreign tokens', async () => {
    const foreign = await signToken({ sub: 'x', name: 'Giả' }, 'someone-else');
    await expect(
      colyseus.sdk.joinOrCreate(CAMPUS_ROOM, { open: true, token: foreign }),
    ).rejects.toThrow();
    await expect(
      colyseus.sdk.joinOrCreate(CAMPUS_ROOM, { open: true, token: 'not.a.token' }),
    ).rejects.toThrow();
  });
});
