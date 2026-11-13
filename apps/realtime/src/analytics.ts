import { userHash, vnDateOf } from '@campus/core';

/** What a room counts (docs/07 §8): totals per day, and who was around as a salted hash. */
export interface AnalyticsSink {
  count(metric: string, dimension?: string, value?: number): void;
  active(userId: string): void;
}

export interface AnalyticsBatch {
  day: string;
  counts: Array<{ metric: string; dimension: string; value: number }>;
  hashes: string[];
}

/**
 * Counts in memory and writes them once a minute, so a busy chat costs nothing per message. A
 * crash loses at most a minute of counts, which is fine for a dashboard.
 */
export class AnalyticsBuffer implements AnalyticsSink {
  private counts = new Map<string, number>();
  private hashes = new Map<string, Set<string>>();
  private readonly write: (batch: AnalyticsBatch) => Promise<void>;
  private readonly salt: string;
  private readonly now: () => Date;

  constructor(
    write: (batch: AnalyticsBatch) => Promise<void>,
    salt: string,
    now = () => new Date(),
  ) {
    this.write = write;
    this.salt = salt;
    this.now = now;
  }

  count(metric: string, dimension = '', value = 1): void {
    const key = `${vnDateOf(this.now())}\u0000${metric}\u0000${dimension}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + value);
  }

  active(userId: string): void {
    const day = vnDateOf(this.now());
    const seen = this.hashes.get(day) ?? new Set<string>();
    seen.add(userHash(this.salt, userId));
    this.hashes.set(day, seen);
  }

  async flush(): Promise<void> {
    const counts = this.counts;
    const hashes = this.hashes;
    this.counts = new Map();
    this.hashes = new Map();
    const days = new Set([
      ...hashes.keys(),
      ...[...counts.keys()].map((key) => key.split('\u0000')[0] as string),
    ]);
    for (const day of days) {
      const batch: AnalyticsBatch = { day, counts: [], hashes: [...(hashes.get(day) ?? [])] };
      for (const [key, value] of counts) {
        const [keyDay, metric, dimension] = key.split('\u0000') as [string, string, string];
        if (keyDay === day) batch.counts.push({ metric, dimension, value });
      }
      try {
        await this.write(batch);
      } catch (error) {
        console.warn(`[analytics] ${day} not written: ${String(error)}`);
      }
    }
  }

  start(intervalMs = 60_000): () => void {
    const timer = setInterval(() => void this.flush(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
