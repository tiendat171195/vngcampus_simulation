import { CAMPUS_ROOM, type ChannelInfo, type HealthResponse } from '@campus/shared';
import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { type CampusMetadata, CampusRoom, type CampusRoomOptions } from './rooms/CampusRoom';

export type ServerOptions = CampusRoomOptions;

/** Assembles the realtime server without binding a port, so tests can boot it themselves. */
export function createServer(options: ServerOptions) {
  return defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: {
      // Automatic assignment asks for an `open` room and gets the fullest one first, so the
      // campus feels busy; a room closes to assignment at the soft cap (docs/05 §1).
      [CAMPUS_ROOM]: defineRoom(CampusRoom, options).filterBy(['open']).sortBy({ clients: -1 }),
    },
    routes: createRouter({
      health: createEndpoint('/health', { method: 'GET' }, async (): Promise<HealthResponse> => {
        return { status: 'ok', service: 'realtime', time: new Date().toISOString() };
      }),
      channels: createEndpoint('/channels', { method: 'GET' }, async (): Promise<ChannelInfo[]> => {
        const rooms = await matchMaker.query({ name: CAMPUS_ROOM });
        return rooms
          .map((room) => {
            const metadata = (room.metadata ?? {}) as Partial<CampusMetadata>;
            return {
              roomId: room.roomId,
              channel: metadata.channel ?? 0,
              players: room.clients,
              open: metadata.open ?? false,
            };
          })
          .sort((a, b) => a.channel - b.channel);
      }),
    }),
  });
}

export type RealtimeServer = ReturnType<typeof createServer>;
