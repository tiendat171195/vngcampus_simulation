import { stripDiacritics } from '@campus/core';
import {
  CAMPUS_ROOM,
  type ChannelInfo,
  type HealthResponse,
  type OnlineEntry,
} from '@campus/shared';
import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { z } from 'zod';
import {
  type CampusMetadata,
  CampusRoom,
  type CampusRoomOptions,
  ONLINE_KEY,
} from './rooms/CampusRoom';

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
      // Who is online, for "find a colleague" (docs/05-multiplayer.md §7). Lines left behind by
      // a crashed process are skipped: their room no longer exists.
      online: createEndpoint(
        '/online',
        { method: 'GET', query: z.object({ q: z.string().max(40).optional() }) },
        async (ctx): Promise<OnlineEntry[]> => {
          const [lines, rooms] = await Promise.all([
            matchMaker.presence.hgetall(ONLINE_KEY),
            matchMaker.query({ name: CAMPUS_ROOM }),
          ]);
          const live = new Set(rooms.map((room) => room.roomId));
          const needle = stripDiacritics(ctx.query?.q ?? '')
            .toLowerCase()
            .trim();
          const entries: OnlineEntry[] = [];
          for (const value of Object.values(lines ?? {})) {
            try {
              const { userId, name, channel, roomId, area, status } = JSON.parse(
                value,
              ) as OnlineEntry;
              if (!live.has(roomId)) continue;
              if (needle && !stripDiacritics(name).toLowerCase().includes(needle)) continue;
              entries.push({ userId, name, channel, roomId, area, status });
            } catch {
              // Skip unreadable lines.
            }
          }
          return entries.sort((a, b) => a.name.localeCompare(b.name, 'vi')).slice(0, 50);
        },
      ),
    }),
  });
}

export type RealtimeServer = ReturnType<typeof createServer>;
