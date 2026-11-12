/**
 * Numbers that client and server must agree on. The server uses the movement values to validate
 * what clients report, so changing them here changes both sides at once.
 * Units: metres, seconds, radians (see docs/02-architecture.md §6).
 */

export const MOVEMENT = {
  walkSpeed: 2.5,
  runSpeed: 5.5,
  gravity: -20,
  jumpHeight: 0.9,
  capsuleRadius: 0.3,
  capsuleHeight: 1.7,
  maxSlopeDeg: 45,
} as const;

export const NET = {
  /** How often a client reports its own transform. */
  clientSendHz: 10,
  /** How often the server broadcasts state patches. */
  serverPatchHz: 10,
  /** Remote avatars are rendered this far in the past so there are always two snapshots to blend. */
  interpolationDelayMs: 200,
  maxExtrapolationMs: 250,
  /** A remote avatar further than this from its target snaps instead of sliding. */
  teleportDistance: 5,
  reconnectGraceSeconds: 30,
} as const;

export const CHANNEL = {
  /** Auto-assignment stops sending new players to a channel at this population. */
  softCap: 80,
  /** Hard limit, reachable only by explicitly joining a colleague's channel. */
  hardCap: 100,
} as const;

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
