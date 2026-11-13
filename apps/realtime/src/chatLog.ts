import type { ReportContextLine } from '@campus/shared';

interface Line {
  at: number;
  userId: string;
  name: string;
  text: string;
  /** Who received it (user ids), the sender included. */
  heard: Set<string>;
}

/**
 * The room's recent chat, in memory only (docs/05 §8): the last 200 lines of the last 24 hours.
 * It exists so that a report can carry what the reporter saw; it is never written anywhere else.
 */
export class ChatLog {
  private lines: Line[] = [];
  private readonly capacity: number;
  private readonly maxAgeMs: number;

  constructor(capacity = 200, maxAgeMs = 24 * 3_600_000) {
    this.capacity = capacity;
    this.maxAgeMs = maxAgeMs;
  }

  add(line: Line): void {
    this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
  }

  /**
   * What the reporter saw in the last 30 minutes (lines they heard or said), up to 20, oldest
   * first; the reported person's lines are marked. Nothing the reporter could not see is shared.
   */
  contextFor(reporterId: string, targetId: string, now: number): ReportContextLine[] {
    this.lines = this.lines.filter((line) => now - line.at < this.maxAgeMs);
    return this.lines
      .filter((line) => now - line.at < 30 * 60_000 && line.heard.has(reporterId))
      .slice(-20)
      .map((line) => ({
        at: new Date(line.at).toISOString(),
        name: line.name,
        text: line.text,
        byTarget: line.userId === targetId,
        byReporter: line.userId === reporterId,
      }));
  }
}
