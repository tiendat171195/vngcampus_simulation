import {
  autofillTomorrow,
  finalizeEndedMissions,
  pruneActivity,
  pruneReportContext,
  settleExpiredSanctions,
  snapshotPeriodBoards,
} from '@campus/core';
import type { Db } from '@campus/db';
import { campusIndex } from '@campus/map-data/campus';

/**
 * Background work of the API process (docs/07 §6), once a minute: close ended missions, keep
 * last week's and last month's leaderboards, lift sanctions that ran out and, from 23:00, fill
 * tomorrow from a template if nobody planned it (docs/08 §4.5). Every step claims its work inside a transaction, so
 * running several API processes at once is safe without a queue.
 */
export function startJobs(db: Db, log: (message: string) => void, intervalMs = 60_000): () => void {
  let running = false;
  let prunedAt = 0;
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
      const lifted = await settleExpiredSanctions(db);
      if (lifted > 0) log(`${lifted} sanctions ran out`);
      const filled = await autofillTomorrow(db, campusIndex);
      if (filled) log(`tomorrow had no daily mission: ${filled} filled from a template`);
      // Retention (docs/09 §6), hourly is plenty.
      if (Date.now() - prunedAt > 3_600_000) {
        prunedAt = Date.now();
        const forgotten = await pruneActivity(db);
        const cleared = await pruneReportContext(db);
        if (forgotten + cleared > 0)
          log(`retention: ${forgotten} old activity rows, chat cleared from ${cleared} reports`);
      }
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
