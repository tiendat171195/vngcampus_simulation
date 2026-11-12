// Starts the *built* API and realtime servers and checks their health endpoints.
// Run after `pnpm build`. Catches what unit tests cannot: a bundle that fails to start, for
// example because an npm dependency used by a bundled workspace package is missing from the app.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const services = [
  {
    name: 'api',
    entry: 'apps/api/dist/index.mjs',
    env: { API_PORT: '3901' },
    url: 'http://127.0.0.1:3901/api/health',
  },
  {
    name: 'realtime',
    entry: 'apps/realtime/dist/index.mjs',
    env: { REALTIME_PORT: '3902' },
    url: 'http://127.0.0.1:3902/health',
  },
];

const TIMEOUT_MS = 15_000;

async function check(service) {
  let output = '';
  const child = spawn(process.execPath, [service.entry], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', ...service.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));

  try {
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`exited early with code ${child.exitCode}`);
      try {
        const response = await fetch(service.url, { signal: AbortSignal.timeout(2000) });
        const body = await response.json();
        if (response.ok && body.status === 'ok' && body.service === service.name) return;
        throw new Error(`unexpected response ${response.status} ${JSON.stringify(body)}`);
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  } catch (error) {
    throw new Error(`${service.name}: ${error.message}\n--- output ---\n${output}`);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

let failed = false;
for (const service of services) {
  try {
    await check(service);
    console.log(`ok   ${service.name}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
