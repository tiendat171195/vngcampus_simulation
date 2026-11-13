import { create } from 'zustand';
import type { LevelId } from '../world/context';

export type ViewpointId = 'overview' | 'gate' | 'atrium' | 'pool' | 'riverside' | 'forecourt';

interface DebugState {
  /** Highest storey drawn; everything above is hidden to look inside the buildings. */
  cutaway: LevelId;
  showCollider: boolean;
  /** The viewpoint last asked for. `seq` changes on every request, so asking twice works. */
  viewpoint: { id: ViewpointId; seq: number };
  setCutaway(level: LevelId): void;
  setShowCollider(value: boolean): void;
  goTo(id: ViewpointId): void;
}

export const useDebugStore = create<DebugState>((set) => ({
  cutaway: 'ROOF',
  showCollider: false,
  viewpoint: { id: 'overview', seq: 0 },
  setCutaway: (cutaway) => set({ cutaway }),
  setShowCollider: (showCollider) => set({ showCollider }),
  goTo: (id) => set((state) => ({ viewpoint: { id, seq: state.viewpoint.seq + 1 } })),
}));

/**
 * Where per-frame numbers are written. The renderer pushes text straight into this element;
 * going through React state would re-render the overlay sixty times a second.
 */
export const statsSink: { element: HTMLElement | null } = { element: null };
