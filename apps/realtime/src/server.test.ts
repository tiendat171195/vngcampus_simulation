import { healthResponseSchema } from '@campus/shared';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from './server';

describe('realtime', () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createServer());
  });
  afterEach(async () => {
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });

  it('keeps the visitor count in sync for everyone in the hello room', async () => {
    const room = await colyseus.createRoom('hello');
    const first = await colyseus.connectTo(room);
    const second = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    expect(room.state.visitors).toBe(2);
    expect(first.state.visitors).toBe(2);
    expect(second.state.visitors).toBe(2);

    await second.leave();
    await room.waitForNextPatch();
    expect(first.state.visitors).toBe(1);
  });

  it('exposes a health endpoint in the shared shape', async () => {
    const response = await colyseus.http.get('/health');
    expect(healthResponseSchema.parse(response.data).service).toBe('realtime');
  });
});
