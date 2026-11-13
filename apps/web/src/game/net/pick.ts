import type { RemotePlayer } from './NetClient';

/**
 * Finds the remote player drawn under a point of the screen, in normalised device coordinates
 * (-1…1). RemotePlayers installs the real implementation while it is mounted.
 */
export const remotePicker: { pick(ndcX: number, ndcY: number): RemotePlayer | null } = {
  pick: () => null,
};
