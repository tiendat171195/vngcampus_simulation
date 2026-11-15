/**
 * Load test for the realtime server (docs/05-multiplayer.md §11).
 *
 *   pnpm --filter @campus/loadtest load -- --url http://127.0.0.1:2567 --bots 100 --seconds 60
 *   … --url https://campus.example/rt --metrics http://<realtime on the private network>:2567/metrics
 *
 * Each bot joins through automatic channel assignment with a development guest identity, walks
 * between outdoor points at walking pace (moving about 40% of the time), sends a move ten times a
 * second while moving, emotes every 20–60 s, chats every 2–5 min and pings every 5 s. The server
 * must run with DEV_GUEST_AUTH=on.
 */
import { parseArgs } from 'node:util';
import { poisOfSet, type Vec2 } from '@campus/map-data';
import { campusIndex } from '@campus/map-data/campus';
import {
  ANIM,
  CAMPUS_ROOM,
  EMOTES,
  encodePosition,
  encodeYaw,
  MOVEMENT,
  MSG,
  type PongMessage,
} from '@campus/shared';
import type { Client as ClientType } from '@colyseus/sdk';

const { values } = parseArgs({
  // pnpm may pass a bare `--` through; it is not an option.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:2567' },
    bots: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '60' },
    /** Bots joining per second. */
    ramp: { type: 'string', default: '20' },
    /** Share of the time a bot is walking, 0–1. */
    moving: { type: 'string', default: '0.4' },
    /**
     * Where the server's numbers are, when `url` goes through the public proxy (which hides
     * them): the realtime server's own address on the private network.
     */
    metrics: { type: 'string' },
  },
});
const URL = values.url as string;
const BOTS = Number(values.bots);
const SECONDS = Number(values.seconds);
const RAMP = Number(values.ramp);
const MOVING = Number(values.moving);
const METRICS = (values.metrics as string | undefined) ?? `${URL}/metrics`;

// Count bytes received by wrapping the WebSocket the SDK uses.
let bytesIn = 0;
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | Blob | string;
      bytesIn +=
        typeof data === 'string'
          ? data.length
          : data instanceof ArrayBuffer
            ? data.byteLength
            : data.size;
    });
  }
} as typeof WebSocket;
// The SDK picks its WebSocket class when it loads, so it is loaded after the wrapper is in place.
const { Client } = await import('@colyseus/sdk');

const spots: Vec2[] = poisOfSet(campusIndex, 'outdoor_common').map((poi) => poi.position);
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)] as T;
const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number,
  );
};

const stats = {
  joined: 0,
  failed: 0,
  joinMs: [] as number[],
  rttMs: [] as number[],
  patches: 0,
  dropped: 0,
  corrections: 0,
};

async function runBot(index: number, until: number): Promise<void> {
  const client = new Client(URL);
  const started = performance.now();
  let room: Awaited<ReturnType<ClientType['joinOrCreate']>>;
  try {
    room = await client.joinOrCreate(CAMPUS_ROOM, {
      open: true,
      guest: { id: `loadtest-bot-${String(index).padStart(5, '0')}`, name: `Bot ${index}` },
    });
  } catch {
    stats.failed++;
    return;
  }
  stats.joined++;
  stats.joinMs.push(performance.now() - started);

  room.onStateChange(() => {
    stats.patches++;
  });
  room.onMessage(MSG.pong, (message: PongMessage) =>
    stats.rttMs.push(performance.now() - message.t),
  );
  for (const type of [MSG.chat, MSG.notice]) room.onMessage(type, () => {});
  room.onLeave(() => {
    if (performance.now() < until) stats.dropped++;
  });

  // Start where the server put us, and go back there whenever it rejects a move, like the game.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const state = room.state as {
    players?: { get(id: string): { x: number; z: number } | undefined };
  };
  const self = state.players?.get(room.sessionId);
  let x = self ? self.x / 32 : 0;
  let z = self ? self.z / 32 : -50;
  room.onMessage(MSG.correct, (message: { x: number; z: number }) => {
    stats.corrections++;
    x = message.x;
    z = message.z;
  });
  let target: Vec2 = pick(spots);
  let moving = Math.random() < MOVING;
  let seq = 0;
  let nextEmote = performance.now() + 20_000 + Math.random() * 40_000;
  let nextChat = performance.now() + 120_000 + Math.random() * 180_000;
  let nextPing = performance.now() + Math.random() * 5000;
  let nextToggle = performance.now() + 2000 + Math.random() * 6000;

  const tick = 100;
  while (performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, tick));
    const now = performance.now();
    if (now > nextToggle) {
      moving = Math.random() < MOVING;
      nextToggle = now + 2000 + Math.random() * 6000;
    }
    if (moving) {
      const dx = target[0] - x;
      const dz = target[1] - z;
      const d = Math.hypot(dx, dz);
      if (d < 1) target = pick(spots);
      else {
        const step = Math.min(d, (MOVEMENT.walkSpeed * tick) / 1000);
        x += (dx / d) * step;
        z += (dz / d) * step;
        seq++;
        room.send(MSG.move, [
          seq,
          encodePosition(x),
          0,
          encodePosition(z),
          encodeYaw(Math.atan2(dx, dz)),
          ANIM.walk,
        ]);
      }
    }
    if (now > nextEmote) {
      room.send(MSG.emote, { id: EMOTES.wave.id });
      nextEmote = now + 20_000 + Math.random() * 40_000;
    }
    if (now > nextChat) {
      room.send(MSG.chat, { text: `Xin chào từ bot ${index}` });
      nextChat = now + 120_000 + Math.random() * 180_000;
    }
    if (now > nextPing) {
      room.send(MSG.ping, { t: now });
      nextPing = now + 5000;
    }
  }
  await room.leave(true).catch(() => {});
}

async function metrics(reset: boolean) {
  const response = await fetch(`${METRICS}${reset ? '?reset=1' : ''}`);
  if (!response.ok) return { unavailable: `${METRICS} answered ${response.status}` };
  return response.json() as Promise<Record<string, unknown>>;
}

const until = performance.now() + SECONDS * 1000;
console.log(`load test: ${BOTS} bots for ${SECONDS} s against ${URL}`);
const bots: Promise<void>[] = [];
for (let i = 0; i < BOTS; i++) {
  bots.push(runBot(i, until));
  await new Promise((resolve) => setTimeout(resolve, 1000 / RAMP));
}
// Measure the steady state only: from the moment everyone has joined.
await new Promise((resolve) => setTimeout(resolve, 3000));
await metrics(true);
bytesIn = 0;
stats.patches = 0;
const steadyFrom = performance.now();
// Read the server just before the bots start leaving.
await new Promise((resolve) => setTimeout(resolve, Math.max(0, until - performance.now() - 1500)));
const server = await metrics(false);
const steadySeconds = (performance.now() - steadyFrom) / 1000;
const patchesSeen = stats.patches;
const bytesSeen = bytesIn;
await Promise.all(bots);

const report = {
  bots: BOTS,
  joined: stats.joined,
  failed: stats.failed,
  droppedDuringRun: stats.dropped,
  correctionsReceived: stats.corrections,
  joinMs: { p50: percentile(stats.joinMs, 50), p95: percentile(stats.joinMs, 95) },
  rttMs: { p50: percentile(stats.rttMs, 50), p95: percentile(stats.rttMs, 95) },
  perBot: {
    patchesPerSecond:
      Math.round((patchesSeen / Math.max(1, stats.joined) / steadySeconds) * 10) / 10,
    kilobytesInPerSecond:
      Math.round((bytesSeen / 1024 / Math.max(1, stats.joined) / steadySeconds) * 10) / 10,
  },
  server,
};
console.log(JSON.stringify(report, null, 2));
process.exit(stats.failed > 0 ? 1 : 0);
