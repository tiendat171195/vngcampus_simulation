import type { HealthResponse } from '@campus/shared';
import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { HelloRoom } from './rooms/HelloRoom';

/** Assembles the realtime server without binding a port, so tests can boot it themselves. */
export function createServer() {
  return defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: {
      hello: defineRoom(HelloRoom),
    },
    routes: createRouter({
      health: createEndpoint('/health', { method: 'GET' }, async (): Promise<HealthResponse> => {
        return { status: 'ok', service: 'realtime', time: new Date().toISOString() };
      }),
    }),
  });
}

export type RealtimeServer = ReturnType<typeof createServer>;
