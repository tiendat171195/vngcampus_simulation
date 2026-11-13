import {
  activeAnnouncements,
  activeSanctions,
  addActivity,
  addCounts,
  createReport,
  readSettings,
} from '@campus/core';
import { createDb } from '@campus/db';
import type { LocalizedText } from '@campus/shared';
import { AnalyticsBuffer } from './analytics';
import { createTokenVerifier } from './auth';
import { devGuestAuthEnabled, devSpawnEnabled, loadEnv } from './env';
import { MissionRuntime } from './missions/runtime';
import { dbSource } from './missions/source';
import { SanctionWatcher } from './moderation';
import { OpsWatcher } from './operations';
import { createServer } from './server';

const env = loadEnv();
// The API owns the schema and applies migrations; the realtime server only reads and writes.
const { db } = createDb(env.DATABASE_URL, { maxConnections: 5 });
const missions = new MissionRuntime(
  dbSource(db, (message) => console.warn(`[missions] ${message}`)),
);
missions.start();
const sanctions = new SanctionWatcher(() => activeSanctions(db));
sanctions.start();
const ops = new OpsWatcher(async () => {
  const settings = await readSettings(db);
  const onAir = await activeAnnouncements(db);
  return {
    chatEnabled: settings.chatEnabled,
    maintenance: settings.maintenance.on ? settings.maintenance.message : null,
    announcements: onAir.map((row) => ({
      id: row.id,
      level: row.level,
      text: row.text as LocalizedText,
      endsAt: row.endsAt.toISOString(),
    })),
  };
});
ops.start();
const analytics = new AnalyticsBuffer(async ({ day, counts, hashes }) => {
  await addCounts(db, day, counts);
  await addActivity(db, day, hashes);
}, env.ANALYTICS_SALT ?? 'development-only-analytics-salt');
analytics.start();
const server = createServer({
  missions,
  sanctions,
  ops,
  analytics,
  reports: async (report) => (await createReport(db, report)) !== null,
  devGuestAuth: devGuestAuthEnabled(env),
  devSpawn: devSpawnEnabled(env),
  verifyToken: createTokenVerifier(new URL(env.AUTH_JWKS_URL)),
  softCap: env.CHANNEL_SOFT_CAP,
  hardCap: env.CHANNEL_HARD_CAP,
});

// Colyseus installs its own SIGINT/SIGTERM handlers that drain rooms before exiting.
await server.listen(env.REALTIME_PORT, env.REALTIME_HOST);
console.log(`realtime listening on ${env.REALTIME_HOST}:${env.REALTIME_PORT}`);
