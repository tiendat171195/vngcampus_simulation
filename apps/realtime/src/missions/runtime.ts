import type { ActiveMission } from '@campus/core';
import { bankOf, type MissionSource, type QuestionBank } from './source';

/**
 * The missions running in this process (docs/06 §5.3). Refreshed from the database every 15
 * seconds — starting and ending need no job, they follow from the clock. Rooms subscribe to hear
 * when the set changes.
 */
export class MissionRuntime {
  missions: ActiveMission[] = [];
  bank: QuestionBank = bankOf([]);
  readonly source: MissionSource;
  private readonly listeners = new Set<() => void>();
  private readonly log: (message: string) => void;
  private key = '';

  constructor(source: MissionSource, log: (message: string) => void = console.warn) {
    this.source = source;
    this.log = log;
  }

  /** Reloads missions and questions; tells the rooms when the running set changed. */
  async refresh(now = new Date()): Promise<void> {
    try {
      const [missions, questions] = await Promise.all([
        this.source.loadActive(now),
        this.source.loadQuestions(),
      ]);
      this.bank = bankOf(questions);
      const key = missions
        .map((mission) => `${mission.id}@${mission.endsAt.getTime()}`)
        .sort()
        .join(',');
      this.missions = missions;
      if (key === this.key) return;
      this.key = key;
      for (const listener of this.listeners) listener();
    } catch (error) {
      // Keep the missions we have; try again next time.
      this.log(`missions not refreshed: ${String(error)}`);
    }
  }

  /** Refreshes now and then every `intervalMs`; returns a function that stops it. */
  start(intervalMs = 15_000): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
