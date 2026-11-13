import { devGuestAuthEnabled, loadEnv } from './env';
import { createServer } from './server';

const env = loadEnv();
const server = createServer({ devGuestAuth: devGuestAuthEnabled(env) });

// Colyseus installs its own SIGINT/SIGTERM handlers that drain rooms before exiting.
await server.listen(env.REALTIME_PORT, env.REALTIME_HOST);
console.log(`realtime listening on ${env.REALTIME_HOST}:${env.REALTIME_PORT}`);
