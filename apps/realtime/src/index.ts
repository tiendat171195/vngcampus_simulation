import { createDb } from '@campus/db';
import { createTokenVerifier } from './auth';
import { devGuestAuthEnabled, devSpawnEnabled, loadEnv } from './env';
import { MissionRuntime } from './missions/runtime';
import { dbSource } from './missions/source';
import { createServer } from './server';

const env = loadEnv();
// The API owns the schema and applies migrations; the realtime server only reads and writes.
const { db } = createDb(env.DATABASE_URL, { maxConnections: 5 });
const missions = new MissionRuntime(
  dbSource(db, (message) => console.warn(`[missions] ${message}`)),
);
missions.start();
const server = createServer({
  missions,
  devGuestAuth: devGuestAuthEnabled(env),
  devSpawn: devSpawnEnabled(env),
  verifyToken: createTokenVerifier(new URL(env.AUTH_JWKS_URL)),
  softCap: env.CHANNEL_SOFT_CAP,
  hardCap: env.CHANNEL_HARD_CAP,
});

// Colyseus installs its own SIGINT/SIGTERM handlers that drain rooms before exiting.
await server.listen(env.REALTIME_PORT, env.REALTIME_HOST);
console.log(`realtime listening on ${env.REALTIME_HOST}:${env.REALTIME_PORT}`);
