import { maskProfanity, normaliseChat } from '@campus/core';
import { distance, floorAt, type Poi, poisOfSet } from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import {
  CHANNEL,
  CHAT,
  type ChatMessage,
  CLOSE,
  type CorrectMessage,
  chatSchema,
  decodePosition,
  emoteSchema,
  encodePosition,
  encodeYaw,
  joinOptionsSchema,
  MSG,
  moveSchema,
  NET,
  type NoticeMessage,
  PLAYER_STATUS,
  type PongMessage,
  pingSchema,
  seatTakeSchema,
} from '@campus/shared';
import {
  type AuthContext,
  type Client,
  CloseCode,
  matchMaker,
  Room,
  ServerError,
} from '@colyseus/core';
import {
  type Accepted,
  checkMove,
  RateLimiter,
  WindowCounter,
  type WorldLimits,
} from '../movement';
import { PlayerState, RoomState } from './state';

export interface CampusRoomOptions {
  /** Accept `guest` identities from join options. Development only, until real sign-in (P3). */
  devGuestAuth: boolean;
  softCap?: number;
  hardCap?: number;
  reconnectGraceSeconds?: number;
}

export interface CampusMetadata {
  channel: number;
  /** Whether automatic assignment may still send new players here. */
  open: boolean;
}

interface Identity {
  userId: string;
  name: string;
}

interface Tracking {
  accepted: Accepted;
  lastSeq: number;
  rate: RateLimiter;
  violations: WindowCounter;
  emotes: RateLimiter;
  chat: RateLimiter;
}

/** Channel-wide pub/sub topic announcing that a user has just joined somewhere. */
const SESSION_TOPIC = 'campus:session-start';
const MOVE_RATE = 15;
const VIOLATION_WINDOW_MS = 10_000;
const VIOLATION_FLAG = 5;
const PING_RATE = 2;
/** One emote every two seconds on average. */
const EMOTE_RATE = 0.5;
/** How close one must stand to sit down, and how far a seated player may drift before standing. */
const SEAT_REACH = 2.5;
const SEAT_LEASH = 1.5;

const LIMITS: WorldLimits = {
  min: campusMap.meta.bounds.min,
  max: campusMap.meta.bounds.max,
  minY: -2,
  maxY: (campusIndex.floors.get('ROOF')?.y ?? 14) + 2,
};

/**
 * One channel of the campus (docs/05-multiplayer.md §1). Everybody in it sees everybody else.
 * Movement is decided by clients and checked here; nothing else is simulated.
 */
export class CampusRoom extends Room<{
  state: RoomState;
  metadata: CampusMetadata;
  client: Client<{ userData: undefined; auth: Identity }>;
}> {
  override state = new RoomState();
  override patchRate = 1000 / NET.serverPatchHz;

  private config!: Required<CampusRoomOptions>;
  private readonly createdAt = Date.now();
  private readonly tracking = new Map<string, Tracking>();
  private readonly onSessionStart = (message: { userId: string; sessionId: string }) => {
    for (const client of this.clients) {
      if (client.auth?.userId === message.userId && client.sessionId !== message.sessionId) {
        client.leave(CLOSE.replaced, 'Tài khoản này vừa vào từ nơi khác.');
      }
    }
  };

  private now(): number {
    return Date.now() - this.createdAt;
  }

  override async onCreate(options: CampusRoomOptions): Promise<void> {
    this.config = {
      devGuestAuth: options.devGuestAuth,
      softCap: options.softCap ?? CHANNEL.softCap,
      hardCap: options.hardCap ?? CHANNEL.hardCap,
      reconnectGraceSeconds: options.reconnectGraceSeconds ?? NET.reconnectGraceSeconds,
    };
    this.maxClients = this.config.hardCap;
    this.state.channel = await this.freeChannelNumber();
    await this.updateListing();
    await this.presence.subscribe(SESSION_TOPIC, this.onSessionStart);

    this.onMessage(MSG.move, (client, payload) => this.handleMove(client, payload));
    this.onMessage(MSG.emote, (client, payload) => this.handleEmote(client, payload));
    this.onMessage(MSG.seatTake, (client, payload) => this.handleSeatTake(client, payload));
    this.onMessage(MSG.seatLeave, (client) => this.releaseSeat(client.sessionId));
    this.onMessage(MSG.chat, (client, payload) => this.handleChat(client, payload));
    const pings = new Map<string, RateLimiter>();
    this.onMessage(MSG.ping, (client, payload) => {
      const limiter = pings.get(client.sessionId) ?? new RateLimiter(PING_RATE, this.now());
      pings.set(client.sessionId, limiter);
      const parsed = pingSchema.safeParse(payload);
      if (!parsed.success || !limiter.take(this.now())) return;
      client.send(MSG.pong, { t: parsed.data.t, serverTime: this.now() } satisfies PongMessage);
    });
  }

  override onAuth(_client: Client, options: unknown, _context: AuthContext): Identity {
    const parsed = joinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) throw new ServerError(400, 'Thông tin vào phòng không hợp lệ.');
    const { guest } = parsed.data;
    if (!guest || !this.config.devGuestAuth) throw new ServerError(401, 'Cần đăng nhập.');
    return { userId: `guest:${guest.id}`, name: guest.name };
  }

  override async onJoin(
    client: Client<{ userData: undefined; auth: Identity }>,
    options: unknown,
  ): Promise<void> {
    const identity = client.auth;
    if (!identity) throw new ServerError(401, 'Cần đăng nhập.');
    const spawn = this.chooseSpawn(joinOptionsSchema.safeParse(options ?? {}).data?.spawn);
    const y = campusIndex.floors.get(spawn.floor)?.y ?? 0;

    const player = new PlayerState();
    player.userId = identity.userId;
    player.name = identity.name;
    player.x = encodePosition(spawn.position[0]);
    player.y = encodePosition(y);
    player.z = encodePosition(spawn.position[1]);
    player.yaw = encodeYaw(((spawn.yawDeg ?? 0) * Math.PI) / 180);
    this.state.players.set(client.sessionId, player);

    const now = this.now();
    this.tracking.set(client.sessionId, {
      accepted: { x: spawn.position[0], y, z: spawn.position[1], at: now },
      lastSeq: -1,
      rate: new RateLimiter(MOVE_RATE, now),
      violations: new WindowCounter(VIOLATION_WINDOW_MS),
      emotes: new RateLimiter(EMOTE_RATE, now),
      chat: new RateLimiter(CHAT.burst / (CHAT.windowMs / 1000), now, CHAT.burst),
    });

    await this.updateListing();
    // One person, one session: any older session of this user, in any channel, is closed.
    this.presence.publish(SESSION_TOPIC, { userId: identity.userId, sessionId: client.sessionId });
  }

  override async onDrop(client: Client, code?: number): Promise<void> {
    // Closed on purpose by the server (replaced, kicked, idle), or by the browser leaving the page
    // (1001, "going away"): no seat is held.
    if (code !== undefined && (code >= 4100 || code === CloseCode.GOING_AWAY)) return;
    const player = this.state.players.get(client.sessionId);
    if (player) player.status = PLAYER_STATUS.reconnecting;
    try {
      await this.allowReconnection(client, this.config.reconnectGraceSeconds);
    } catch {
      // Grace period over; onLeave cleans up.
    }
  }

  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.status = PLAYER_STATUS.active;
  }

  override async onLeave(client: Client): Promise<void> {
    this.releaseSeat(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.tracking.delete(client.sessionId);
    await this.updateListing();
  }

  override async onDispose(): Promise<void> {
    await this.presence.unsubscribe(SESSION_TOPIC, this.onSessionStart);
  }

  override onBeforePatch(state: RoomState): void {
    state.time = this.now();
  }

  private handleMove(client: Client, payload: unknown): void {
    const tracking = this.tracking.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!tracking || !player) return;
    const now = this.now();
    if (!tracking.rate.take(now)) return;
    const parsed = moveSchema.safeParse(payload);
    if (!parsed.success) return;
    const [seq, xi, yi, zi, yaw, anim] = parsed.data;
    // Out-of-order packets are dropped; the next one supersedes them anyway.
    if (seq <= tracking.lastSeq) return;
    tracking.lastSeq = seq;

    const next = { x: decodePosition(xi), y: decodePosition(yi), z: decodePosition(zi) };
    const verdict = checkMove(tracking.accepted, next, now, LIMITS);
    if (!verdict.ok) {
      const { x, y, z } = tracking.accepted;
      client.send(MSG.correct, { x, y, z, reason: verdict.reason } satisfies CorrectMessage);
      if (tracking.violations.add(now) === VIOLATION_FLAG) {
        console.warn(
          `[campus] repeated movement violations from ${player.userId} in ${this.roomId}`,
        );
      }
      return;
    }

    tracking.accepted = { ...next, at: now };
    if (player.seatId) {
      const seat = campusIndex.pois.get(player.seatId);
      if (!seat || distance(seat.position, [next.x, next.z]) > SEAT_LEASH)
        this.releaseSeat(client.sessionId);
    }
    player.x = xi;
    player.y = yi;
    player.z = zi;
    player.yaw = yaw;
    player.anim = anim;
    if (player.status === PLAYER_STATUS.reconnecting) player.status = PLAYER_STATUS.active;
  }

  private handleEmote(client: Client, payload: unknown): void {
    const tracking = this.tracking.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const parsed = emoteSchema.safeParse(payload);
    if (!tracking || !player || !parsed.success || !tracking.emotes.take(this.now())) return;
    player.emote = parsed.data.id;
    // The sequence number lets clients replay the same emote twice in a row.
    player.emoteSeq = (player.emoteSeq + 1) % 65536;
  }

  /**
   * Nearby chat (docs/05-multiplayer.md §8): cleaned, filtered and sent only to people within
   * earshot, sender included. Nothing is stored.
   */
  private handleChat(client: Client, payload: unknown): void {
    const tracking = this.tracking.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const parsed = chatSchema.safeParse(payload);
    if (!tracking || !player || !parsed.success) return;
    const text = normaliseChat(parsed.data.text, CHAT.maxLength);
    if (!text) return;
    if (!tracking.chat.take(this.now())) {
      client.send(MSG.notice, {
        text: 'Bạn đang gửi hơi nhanh, chờ một chút nhé.',
      } satisfies NoticeMessage);
      return;
    }
    const message: ChatMessage = {
      from: client.sessionId,
      name: player.name,
      text: maskProfanity(text),
      ts: this.now(),
    };
    const origin = tracking.accepted;
    for (const other of this.clients) {
      const there = this.tracking.get(other.sessionId)?.accepted;
      if (!there) continue;
      const near =
        Math.hypot(there.x - origin.x, there.z - origin.z) <= CHAT.radius &&
        Math.abs(there.y - origin.y) < 3;
      if (near) other.send(MSG.chat, message);
    }
  }

  private handleSeatTake(client: Client, payload: unknown): void {
    const tracking = this.tracking.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const parsed = seatTakeSchema.safeParse(payload);
    if (!tracking || !player || !parsed.success) return;
    const seat = campusIndex.pois.get(parsed.data.seatId);
    const notice = (text: string) => client.send(MSG.notice, { text } satisfies NoticeMessage);
    if (seat?.kind !== 'seat') return;
    const { x, y, z } = tracking.accepted;
    if (floorAt(campusIndex, y) !== seat.floor || distance(seat.position, [x, z]) > SEAT_REACH) {
      notice('Lại gần hơn để ngồi.');
      return;
    }
    const holder = this.state.seats.get(seat.id);
    if (holder && holder !== client.sessionId) {
      notice('Ghế này đã có người ngồi.');
      return;
    }
    this.releaseSeat(client.sessionId);
    this.state.seats.set(seat.id, client.sessionId);
    player.seatId = seat.id;
  }

  private releaseSeat(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player?.seatId) return;
    if (this.state.seats.get(player.seatId) === sessionId) this.state.seats.delete(player.seatId);
    player.seatId = '';
  }

  private chooseSpawn(requested: string | undefined): Poi {
    // Picking a spawn point is a development convenience until P3; it is only honoured when
    // development identities are.
    const wanted =
      requested && this.config.devGuestAuth ? campusIndex.pois.get(requested) : undefined;
    if (wanted) return wanted;
    // The free spot furthest from everyone already standing at the gate, so people do not appear
    // inside each other.
    const gate = poisOfSet(campusIndex, 'players_gate');
    const occupied = [...this.state.players.values()].map(
      (player) => [decodePosition(player.x), decodePosition(player.z)] as const,
    );
    let best: Poi | undefined;
    let bestClearance = Number.NEGATIVE_INFINITY;
    for (const poi of gate) {
      const clearance = occupied.reduce(
        (nearest, [x, z]) =>
          Math.min(nearest, Math.hypot(poi.position[0] - x, poi.position[1] - z)),
        Number.POSITIVE_INFINITY,
      );
      if (clearance > bestClearance + 1e-6) {
        best = poi;
        bestClearance = clearance;
      }
    }
    if (!best) throw new ServerError(500, 'Bản đồ không có điểm xuất hiện.');
    return best;
  }

  private async updateListing(): Promise<void> {
    const open = this.clients.length < this.config.softCap;
    await this.setMetadata({ channel: this.state.channel, open });
  }

  /** The lowest channel number not used by another live room. */
  private async freeChannelNumber(): Promise<number> {
    const rooms = await matchMaker.query({ name: this.roomName });
    const used = new Set(
      rooms
        .filter((room) => room.roomId !== this.roomId)
        .map((room) => (room.metadata as Partial<CampusMetadata> | undefined)?.channel)
        .filter((channel): channel is number => typeof channel === 'number'),
    );
    let channel = 1;
    while (used.has(channel)) channel++;
    return channel;
  }
}
