import { maskProfanity, normaliseChat } from '@campus/core';
import { areasAt, distance, floorAt, isWalkable, type Poi, poisOfSet } from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import {
  afkSchema,
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
  type OnlineEntry,
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
import type { Identity, TokenVerifier } from '../auth';
import { countMessage, recordPatch } from '../metrics';
import {
  type Accepted,
  checkMove,
  RateLimiter,
  WindowCounter,
  type WorldLimits,
} from '../movement';
import { PlayerState, RoomState } from './state';

export interface CampusRoomOptions {
  /** Accept `guest` identities from join options. Development and load tests only. */
  devGuestAuth: boolean;
  /**
   * Honour `spawn` (a POI id) from join options. Development and tests only: in production it
   * would let anyone reload their way to a mission's destination. Defaults to `devGuestAuth`.
   */
  devSpawn?: boolean;
  /** Checks API access tokens; without it only development identities can join. */
  verifyToken?: TokenVerifier;
  softCap?: number;
  hardCap?: number;
  reconnectGraceSeconds?: number;
  /** Without input for this long a player shows as away. */
  idleAfkSeconds?: number;
  /** Without input for this long a player is asked to leave, freeing the place. */
  idleKickSeconds?: number;
}

export interface CampusMetadata {
  channel: number;
  /** Whether automatic assignment may still send new players here. */
  open: boolean;
}

interface Tracking {
  accepted: Accepted;
  lastSeq: number;
  rate: RateLimiter;
  violations: WindowCounter;
  emotes: RateLimiter;
  chat: RateLimiter;
  /** Room clock of the last deliberate input. */
  lastActivity: number;
  /** The tab is hidden, as reported by the client. */
  hidden: boolean;
  /** What the online directory last showed for this player, to write only on change. */
  listed: string;
}

/** Channel-wide pub/sub topic announcing that a user has just joined somewhere. */
const SESSION_TOPIC = 'campus:session-start';
/** Presence hash: user id → OnlineEntry JSON, for the online directory. */
export const ONLINE_KEY = 'campus:online';
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

  private config!: Required<Omit<CampusRoomOptions, 'verifyToken'>>;
  private verifyToken: TokenVerifier | undefined;
  private readonly createdAt = Date.now();
  private readonly tracking = new Map<string, Tracking>();
  private housekeeping: ReturnType<typeof setInterval> | undefined;
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
      devSpawn: options.devSpawn ?? options.devGuestAuth,
      softCap: options.softCap ?? CHANNEL.softCap,
      hardCap: options.hardCap ?? CHANNEL.hardCap,
      reconnectGraceSeconds: options.reconnectGraceSeconds ?? NET.reconnectGraceSeconds,
      idleAfkSeconds: options.idleAfkSeconds ?? 5 * 60,
      idleKickSeconds: options.idleKickSeconds ?? 30 * 60,
    };
    this.verifyToken = options.verifyToken;
    this.maxClients = this.config.hardCap;
    this.state.channel = await this.freeChannelNumber();
    await this.updateListing();
    await this.presence.subscribe(SESSION_TOPIC, this.onSessionStart);

    this.onMessage(MSG.move, (client, payload) => this.handleMove(client, payload));
    this.onMessage(MSG.emote, (client, payload) => this.handleEmote(client, payload));
    this.onMessage(MSG.seatTake, (client, payload) => this.handleSeatTake(client, payload));
    this.onMessage(MSG.seatLeave, (client) => this.releaseSeat(client.sessionId));
    this.onMessage(MSG.chat, (client, payload) => this.handleChat(client, payload));
    this.onMessage(MSG.afk, (client, payload) => {
      const tracking = this.tracking.get(client.sessionId);
      const parsed = afkSchema.safeParse(payload);
      if (!tracking || !parsed.success) return;
      tracking.hidden = parsed.data.on;
      if (!parsed.data.on) tracking.lastActivity = this.now();
      this.refreshStatus(client.sessionId);
    });
    this.housekeeping = setInterval(() => void this.tidy(), 1000);
    const pings = new Map<string, RateLimiter>();
    this.onMessage(MSG.ping, (client, payload) => {
      const limiter = pings.get(client.sessionId) ?? new RateLimiter(PING_RATE, this.now());
      pings.set(client.sessionId, limiter);
      const parsed = pingSchema.safeParse(payload);
      if (!parsed.success || !limiter.take(this.now())) return;
      client.send(MSG.pong, { t: parsed.data.t, serverTime: this.now() } satisfies PongMessage);
    });
  }

  override async onAuth(
    _client: Client,
    options: unknown,
    _context: AuthContext,
  ): Promise<Identity> {
    const parsed = joinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) throw new ServerError(400, 'Thông tin vào phòng không hợp lệ.');
    const { token, guest } = parsed.data;
    if (token && this.verifyToken) {
      try {
        return await this.verifyToken(token);
      } catch {
        throw new ServerError(401, 'Phiên đăng nhập đã hết hạn.');
      }
    }
    if (guest && this.config.devGuestAuth)
      return { userId: `guest:${guest.id}`, name: guest.name, guest: true };
    throw new ServerError(401, 'Cần đăng nhập.');
  }

  override async onJoin(
    client: Client<{ userData: undefined; auth: Identity }>,
    options: unknown,
  ): Promise<void> {
    const identity = client.auth;
    if (!identity) throw new ServerError(401, 'Cần đăng nhập.');
    const joinOptions = joinOptionsSchema.safeParse(options ?? {}).data;
    const spawn = this.chooseSpawn(joinOptions?.spawn, joinOptions?.resume);
    const y = spawn.y;

    const player = new PlayerState();
    player.userId = identity.userId;
    player.name = identity.name;
    player.tag = identity.guest ? 'Khách' : '';
    player.x = encodePosition(spawn.x);
    player.y = encodePosition(y);
    player.z = encodePosition(spawn.z);
    player.yaw = encodeYaw(spawn.yaw);
    this.state.players.set(client.sessionId, player);

    const now = this.now();
    this.tracking.set(client.sessionId, {
      accepted: { x: spawn.x, y, z: spawn.z, at: now },
      lastSeq: -1,
      rate: new RateLimiter(MOVE_RATE, now),
      violations: new WindowCounter(VIOLATION_WINDOW_MS),
      emotes: new RateLimiter(EMOTE_RATE, now),
      chat: new RateLimiter(CHAT.burst / (CHAT.windowMs / 1000), now, CHAT.burst),
      lastActivity: now,
      hidden: false,
      listed: '',
    });

    await this.updateListing();
    await this.updateDirectory(client.sessionId);
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
    const player = this.state.players.get(client.sessionId);
    if (player) await this.unlist(player.userId, client.sessionId);
    this.state.players.delete(client.sessionId);
    this.tracking.delete(client.sessionId);
    await this.updateListing();
  }

  override async onDispose(): Promise<void> {
    clearInterval(this.housekeeping);
    await this.presence.unsubscribe(SESSION_TOPIC, this.onSessionStart);
  }

  /** Measures encoding and sending each patch, the main cost of a busy room. */
  override broadcastPatch(): boolean {
    const started = performance.now();
    const sent = super.broadcastPatch();
    recordPatch(performance.now() - started);
    return sent;
  }

  override onBeforePatch(state: RoomState): void {
    state.time = this.now();
  }

  private handleMove(client: Client, payload: unknown): void {
    countMessage();
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

    const moved = Math.hypot(next.x - tracking.accepted.x, next.z - tracking.accepted.z) > 0.05;
    tracking.accepted = { ...next, at: now };
    if (moved) this.markActive(client.sessionId);
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
    this.markActive(client.sessionId);
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
    this.markActive(client.sessionId);
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

  private markActive(sessionId: string): void {
    const tracking = this.tracking.get(sessionId);
    if (!tracking) return;
    tracking.lastActivity = this.now();
    this.refreshStatus(sessionId);
  }

  /** Active, away (hidden tab or idle) or reconnecting, from what is known about the session. */
  private refreshStatus(sessionId: string): void {
    const tracking = this.tracking.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!tracking || !player || player.status === PLAYER_STATUS.reconnecting) return;
    const idle = this.now() - tracking.lastActivity > this.config.idleAfkSeconds * 1000;
    player.status = tracking.hidden || idle ? PLAYER_STATUS.afk : PLAYER_STATUS.active;
  }

  /** Once a second: idle players become away, then are asked to leave; the directory follows. */
  private async tidy(): Promise<void> {
    const now = this.now();
    for (const client of this.clients) {
      const tracking = this.tracking.get(client.sessionId);
      if (!tracking) continue;
      if (now - tracking.lastActivity > this.config.idleKickSeconds * 1000) {
        client.leave(CLOSE.idle, 'Bạn đã rời bàn phím khá lâu.');
        continue;
      }
      this.refreshStatus(client.sessionId);
      await this.updateDirectory(client.sessionId);
    }
  }

  /** Writes this player's line of the online directory if it changed. */
  private async updateDirectory(sessionId: string): Promise<void> {
    const tracking = this.tracking.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!tracking || !player) return;
    const { x, y, z } = tracking.accepted;
    const floor = floorAt(campusIndex, y);
    const place = areasAt(campusIndex, [x, z], floor).find((area) => !area.tags.includes('base'));
    const entry: OnlineEntry & { sessionId: string } = {
      userId: player.userId,
      name: player.name,
      channel: this.state.channel,
      roomId: this.roomId,
      area: place?.name.vi ?? '',
      status: player.status,
      sessionId,
    };
    const value = JSON.stringify(entry);
    if (value === tracking.listed) return;
    tracking.listed = value;
    await this.presence.hset(ONLINE_KEY, player.userId, value);
  }

  /** Removes a player from the directory, unless a newer session of theirs has taken the line. */
  private async unlist(userId: string, sessionId: string): Promise<void> {
    const current = await this.presence.hget(ONLINE_KEY, userId);
    if (!current) return;
    try {
      if ((JSON.parse(current) as { sessionId?: string }).sessionId !== sessionId) return;
    } catch {
      // Unreadable line: remove it.
    }
    await this.presence.hdel(ONLINE_KEY, userId);
  }

  private chooseSpawn(
    requested: string | undefined,
    resume: { x: number; y: number; z: number } | undefined,
  ): { x: number; y: number; z: number; yaw: number } {
    const fromPoi = (poi: Poi) => ({
      x: poi.position[0],
      y: campusIndex.floors.get(poi.floor)?.y ?? 0,
      z: poi.position[1],
      yaw: ((poi.yawDeg ?? 0) * Math.PI) / 180,
    });
    // Keeping one's place when switching channel; anywhere one could have walked to is fine.
    if (resume && isWalkable(campusIndex, [resume.x, resume.z], floorAt(campusIndex, resume.y))) {
      return { ...resume, yaw: 0 };
    }
    // Picking a spawn point is a development and test convenience.
    const wanted = requested && this.config.devSpawn ? campusIndex.pois.get(requested) : undefined;
    if (wanted) return fromPoi(wanted);
    return fromPoi(this.gateSpawn());
  }

  private gateSpawn(): Poi {
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
