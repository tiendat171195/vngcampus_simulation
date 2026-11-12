import { NET } from '@campus/shared';
import { Room } from '@colyseus/core';
import { type SchemaType, schema, t } from '@colyseus/schema';

export const HelloState = schema(
  {
    /** How many clients are connected to this room right now. */
    visitors: t.uint16().default(0),
  },
  'HelloState',
);
export type HelloState = SchemaType<typeof HelloState>;

/**
 * Placeholder room that proves the browser ↔ realtime path end to end.
 * `CampusRoom` replaces it in P2.1 (docs/05-multiplayer.md).
 */
export class HelloRoom extends Room<{ state: HelloState }> {
  override state = new HelloState();
  override patchRate = 1000 / NET.serverPatchHz;

  override onJoin(): void {
    this.state.visitors = this.clients.length;
  }

  override onLeave(): void {
    this.state.visitors = this.clients.length;
  }
}
