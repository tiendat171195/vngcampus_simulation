import {
  type AnimId,
  CAMPUS_ROOM,
  CLOSE,
  type CorrectMessage,
  type DevGuest,
  decodePosition,
  decodeYaw,
  encodePosition,
  encodeYaw,
  MSG,
  NET,
  type NoticeMessage,
  type PongMessage,
} from '@campus/shared';
import { Client, CloseCode, type Room } from '@colyseus/sdk';
import { type NetStatus, useSession } from '../core/session';
import { ClockSync, Interpolator } from './Interpolator';

/** What the client reads from the room state; the server schema is in apps/realtime. */
interface WirePlayer {
  userId: string;
  name: string;
  status: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  emote: number;
  emoteSeq: number;
  seatId: string;
}
interface WireState {
  channel: number;
  time: number;
  players: {
    forEach(callback: (player: WirePlayer, sessionId: string) => void): void;
    get(key: string): WirePlayer | undefined;
  };
  seats: { forEach(callback: (sessionId: string, seatId: string) => void): void };
}

export interface RemotePlayer {
  sessionId: string;
  userId: string;
  name: string;
  status: number;
  anim: number;
  emote: number;
  emoteSeq: number;
  motion: Interpolator;
}

export interface Transform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: AnimId;
}

const SEND_INTERVAL_MS = 1000 / NET.clientSendHz;
const PING_INTERVAL_MS = 5000;
/** Three quick pings right after joining settle the clock before the first interpolation. */
const WARMUP_PINGS = 3;

/**
 * The connection to one campus channel. Plain TypeScript, read by the game loop every frame;
 * only rare changes (status, channel, head count) are pushed to the React store.
 */
export class NetClient {
  readonly remotes = new Map<string, RemotePlayer>();
  readonly clock = new ClockSync();
  /** Seat POI id → session id, as the server last reported. */
  readonly seats = new Map<string, string>();
  /** The seat the server says we occupy, or ''. */
  seatId = '';
  /** Called once, with the position the server chose for us, right after joining. */
  onSpawn: ((transform: Omit<Transform, 'anim'>) => void) | null = null;
  /** Called when the server grants or takes away our seat ('' when standing). */
  onSeat: ((seatId: string) => void) | null = null;
  /** Called when the server rejects a move; jump back to this position. */
  onCorrect: ((x: number, y: number, z: number) => void) | null = null;

  private client: Client | null = null;
  private room: Room<unknown, WireState> | null = null;
  private sessionId = '';
  private spawned = false;
  private seq = 0;
  private lastSendAt = Number.NEGATIVE_INFINITY;
  private lastSent = '';
  private lastPingAt = Number.NEGATIVE_INFINITY;
  private pingsSent = 0;

  get status(): NetStatus {
    return useSession.getState().net.status;
  }

  async connect(guest: DevGuest, options: { spawn?: string; roomId?: string } = {}): Promise<void> {
    if (this.room) return;
    this.setStatus('connecting');
    try {
      this.client ??= new Client(`${window.location.origin}/rt`);
      const joinOptions = { guest, spawn: options.spawn };
      const room = options.roomId
        ? await this.client.joinById<WireState>(options.roomId, joinOptions)
        : await this.client.joinOrCreate<WireState>(CAMPUS_ROOM, { ...joinOptions, open: true });
      this.attach(room as unknown as Room<unknown, WireState>);
    } catch (error) {
      console.warn('[campus] could not join a channel', error);
      this.setStatus('offline');
    }
  }

  /** Leaves on purpose (closing the tab, switching channel). */
  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) await room.leave(true).catch(() => {});
    this.remotes.clear();
  }

  /** Called every frame with the local player's state; sends at most 10 times a second. */
  update(localNow: number, transform: Transform): void {
    const room = this.room;
    if (!room || this.status !== 'online') return;

    const pingDue = this.pingsSent < WARMUP_PINGS ? 300 : PING_INTERVAL_MS;
    if (localNow - this.lastPingAt > pingDue) {
      this.lastPingAt = localNow;
      this.pingsSent++;
      room.send(MSG.ping, { t: localNow });
    }

    if (!this.spawned || localNow - this.lastSendAt < SEND_INTERVAL_MS) return;
    const xi = encodePosition(transform.x);
    const yi = encodePosition(transform.y);
    const zi = encodePosition(transform.z);
    const yaw = encodeYaw(transform.yaw);
    const key = `${xi},${yi},${zi},${yaw},${transform.anim}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.lastSendAt = localNow;
    this.seq++;
    room.send(MSG.move, [this.seq, xi, yi, zi, yaw, transform.anim]);
  }

  sendEmote(id: number): void {
    if (this.status === 'online') this.room?.send(MSG.emote, { id });
  }

  takeSeat(seatId: string): void {
    if (this.status === 'online') this.room?.send(MSG.seatTake, { seatId });
  }

  leaveSeat(): void {
    if (this.status === 'online' && this.seatId) this.room?.send(MSG.seatLeave, {});
  }

  /** Room time at which remote players should be drawn. */
  renderTime(localNow: number): number {
    return this.clock.serverNow(localNow) - NET.interpolationDelayMs;
  }

  private attach(room: Room<unknown, WireState>): void {
    this.room = room;
    // The SDK only retries for rooms joined at least 5 s ago and waits up to 5 s between tries;
    // a phone that loses signal right after joining should still come back, and quickly.
    room.reconnection.minUptime = 1000;
    room.reconnection.maxDelay = 3000;
    this.sessionId = room.sessionId;
    this.spawned = false;
    this.lastSent = '';
    this.pingsSent = 0;
    this.lastPingAt = Number.NEGATIVE_INFINITY;
    this.setStatus('online');

    room.onStateChange((state) => this.ingest(state));
    room.onMessage(MSG.pong, (message: PongMessage) => {
      this.clock.observe(message.t, performance.now(), message.serverTime);
    });
    room.onMessage(MSG.correct, (message: CorrectMessage) => {
      this.lastSent = '';
      this.onCorrect?.(message.x, message.y, message.z);
    });
    room.onMessage(MSG.notice, (message: NoticeMessage) =>
      useSession.getState().showNotice(message.text),
    );
    room.onDrop(() => this.setStatus('reconnecting'));
    room.onReconnect(() => this.setStatus('online'));
    room.onLeave((code) => {
      if (this.room !== room) return;
      this.room = null;
      this.remotes.clear();
      this.setStatus(
        code === CLOSE.replaced ? 'replaced' : code === CloseCode.CONSENTED ? 'idle' : 'offline',
      );
    });
  }

  private ingest(state: WireState): void {
    const now = performance.now();
    this.clock.seed(now, state.time);
    const seen = new Set<string>();

    state.players.forEach((player, sessionId) => {
      if (sessionId === this.sessionId) {
        if (player.seatId !== this.seatId) {
          this.seatId = player.seatId;
          this.onSeat?.(player.seatId);
        }
        if (!this.spawned) {
          this.spawned = true;
          this.onSpawn?.({
            x: decodePosition(player.x),
            y: decodePosition(player.y),
            z: decodePosition(player.z),
            yaw: decodeYaw(player.yaw),
          });
        }
        return;
      }
      seen.add(sessionId);
      let remote = this.remotes.get(sessionId);
      if (!remote) {
        remote = {
          sessionId,
          userId: player.userId,
          name: player.name,
          status: 0,
          anim: 0,
          emote: 0,
          emoteSeq: 0,
          motion: new Interpolator(),
        };
        this.remotes.set(sessionId, remote);
      }
      remote.name = player.name;
      remote.status = player.status;
      remote.anim = player.anim;
      remote.emote = player.emote;
      remote.emoteSeq = player.emoteSeq;
      remote.motion.push({
        t: state.time,
        x: decodePosition(player.x),
        y: decodePosition(player.y),
        z: decodePosition(player.z),
        yaw: decodeYaw(player.yaw),
      });
    });

    for (const sessionId of this.remotes.keys())
      if (!seen.has(sessionId)) this.remotes.delete(sessionId);
    this.seats.clear();
    state.seats.forEach((sessionId, seatId) => {
      this.seats.set(seatId, sessionId);
    });

    const { net, setNet } = useSession.getState();
    const players = this.remotes.size + 1;
    if (net.channel !== state.channel || net.players !== players)
      setNet({ channel: state.channel, players });
  }

  private setStatus(status: NetStatus): void {
    useSession.getState().setNet({ status });
  }
}
