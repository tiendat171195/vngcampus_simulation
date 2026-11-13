import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

/** Rolling sample of durations in milliseconds, for percentiles. */
class Samples {
  private readonly values: number[] = [];
  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  add(value: number): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }
  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
  }
  reset(): void {
    this.values.length = 0;
  }
}

/** The histogram records the time between ticks of a timer this often; the delay is the excess. */
const LOOP_RESOLUTION_MS = 10;
const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
loop.enable();

const patch = new Samples(5000);
const counters = { messagesIn: 0 };
let windowStart = performance.now();
let cpuStart = process.cpuUsage();

/** Time spent encoding and sending one room's patch. */
export function recordPatch(ms: number): void {
  patch.add(ms);
}

export function countMessage(): void {
  counters.messagesIn++;
}

export interface MetricsSnapshot {
  /** Seconds covered by this snapshot (since the previous reset). */
  window: number;
  patchMs: { p50: number; p95: number; p99: number; max: number };
  eventLoopDelayMs: { p50: number; p99: number; max: number };
  /** Share of one CPU core used by this process, 0–1 per core. */
  cpu: number;
  memoryMb: { rss: number; heapUsed: number };
  messagesInPerSecond: number;
}

/** Numbers since the last call with `reset`; used by the load test and, later, monitoring. */
export function snapshot(reset = false): MetricsSnapshot {
  const now = performance.now();
  const seconds = Math.max(0.001, (now - windowStart) / 1000);
  const cpu = process.cpuUsage(cpuStart);
  const memory = process.memoryUsage();
  const result: MetricsSnapshot = {
    window: Math.round(seconds),
    patchMs: {
      p50: round(patch.percentile(50)),
      p95: round(patch.percentile(95)),
      p99: round(patch.percentile(99)),
      max: round(patch.percentile(100)),
    },
    eventLoopDelayMs: {
      p50: loopDelay(loop.percentile(50)),
      p99: loopDelay(loop.percentile(99)),
      max: loopDelay(loop.max),
    },
    cpu: round((cpu.user + cpu.system) / 1e6 / seconds),
    memoryMb: {
      rss: Math.round(memory.rss / 2 ** 20),
      heapUsed: Math.round(memory.heapUsed / 2 ** 20),
    },
    messagesInPerSecond: Math.round(counters.messagesIn / seconds),
  };
  if (reset) {
    patch.reset();
    loop.reset();
    counters.messagesIn = 0;
    windowStart = now;
    cpuStart = process.cpuUsage();
  }
  return result;
}

const round = (value: number) => Math.round(value * 100) / 100;
const loopDelay = (nanoseconds: number) =>
  round(Math.max(0, nanoseconds / 1e6 - LOOP_RESOLUTION_MS));
