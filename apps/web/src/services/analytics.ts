import type { ClientEvent } from '@campus/shared';
import { useSession } from '../game/core/session';
import { accessToken } from './auth';

/**
 * What the game reports about itself (docs/07 §8): load time, frame rate and error codes, sent
 * in small batches. The server counts them into buckets and keeps nothing per person.
 */
const queue: ClientEvent[] = [];
let timer = 0;
let errorsSent = 0;
const VISITED_KEY = 'campus.visited.v1';

export const deviceKind = (): 'desktop' | 'mobile' =>
  window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';

export function track(event: ClientEvent): void {
  queue.push(event);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), queue.length >= 20 ? 0 : 10_000);
}

async function flush(keepalive = false): Promise<void> {
  if (queue.length === 0) return;
  // Before sign-in there is nobody to send as; try again later.
  if (useSession.getState().phase !== 'playing') {
    timer = window.setTimeout(() => void flush(), 15_000);
    return;
  }
  const token = await accessToken().catch(() => null);
  if (!token) return;
  const events = queue.splice(0, 20);
  await fetch('/api/v1/analytics', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
    keepalive,
  }).catch(() => {});
  if (queue.length > 0) await flush(keepalive);
}

/** Frames per second over a few seconds, measured only while the tab is visible. */
function measureFps(seconds: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (document.hidden) return resolve(null);
    let frames = 0;
    const started = performance.now();
    const step = (now: number) => {
      if (document.hidden) return resolve(null);
      frames += 1;
      if (now - started >= seconds * 1000) resolve((frames * 1000) / (now - started));
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

let started = false;

/** Starts reporting for this page: once the world is up, every few minutes, on errors. */
export function startAnalytics(worldReadyMs: number): void {
  if (started) return;
  started = true;
  let firstVisit = false;
  try {
    firstVisit = localStorage.getItem(VISITED_KEY) === null;
    localStorage.setItem(VISITED_KEY, '1');
  } catch {
    // Private mode: counted as a return visit.
  }
  track({ name: 'world_loaded', ms: Math.round(worldReadyMs), firstVisit });

  const sample = async () => {
    if (useSession.getState().phase !== 'playing') return;
    const fps = await measureFps(5);
    if (fps === null) return;
    track({
      name: 'perf_sample',
      fps: Math.round(fps * 10) / 10,
      device: deviceKind(),
      quality: useSession.getState().quality.level,
    });
  };
  window.setTimeout(() => void sample(), 60_000);
  window.setInterval(() => void sample(), 5 * 60_000);

  const error = (name: string) => {
    if (errorsSent >= 5) return;
    errorsSent += 1;
    // Only a short code: messages can carry what someone typed.
    const code = name.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60) || 'Error';
    track({ name: 'client_error', code });
  };
  window.addEventListener('error', (event) =>
    error((event.error as Error | undefined)?.name ?? 'Error'),
  );
  window.addEventListener('unhandledrejection', (event) =>
    error((event.reason as Error | undefined)?.name ?? 'UnhandledRejection'),
  );
  window.addEventListener('pagehide', () => void flush(true));
}
