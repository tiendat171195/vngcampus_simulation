import { finalizeEndedMissions, snapshotPeriodBoards } from '@campus/core';
import type { Db } from '@campus/db';

/**
 * Background work of the API process (docs/07 §6), once a minute: close ended missions and keep
 * last week's and last month's leaderboards. Every step claims its work inside a transaction, so
 * running several API processes at once is safe without a queue.
 */
export function startJobs(db: Db, log: (message: string) => void, intervalMs = 60_000): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const result of await finalizeEndedMissions(db))
        log(
          `mission ${result.missionId} closed: ${result.completions}/${result.participants} completed` +
            (result.communityReached ? ', community goal reached' : ''),
        );
      for (const key of await snapshotPeriodBoards(db)) log(`leaderboard ${key} kept`);
    } catch (error) {
      log(`jobs failed: ${String(error)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}
