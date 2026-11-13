import { create } from 'zustand';
import type { LevelId } from '../world/context';

export type ViewpointId = 'overview' | 'gate' | 'atrium' | 'pool' | 'riverside' | 'forecourt';

interface DebugState {
  /** `follow` is the game camera behind the character; `free` detaches it for inspection. */
  cameraMode: 'follow' | 'free';
  /** Highest storey drawn; everything above is hidden to look inside the buildings. */
  cutaway: LevelId;
  showCollider: boolean;
  /** The viewpoint last asked for. `seq` changes on every request, so asking twice works. */
  viewpoint: { id: ViewpointId; seq: number };
  setCameraMode(mode: 'follow' | 'free'): void;
  setCutaway(level: LevelId): void;
  setShowCollider(value: boolean): void;
  /** Detaches the camera and moves it to a preset viewpoint. */
  goTo(id: ViewpointId): void;
}

export const useDebugStore = create<DebugState>((set) => ({
  cameraMode: 'follow',
  cutaway: 'ROOF',
  showCollider: false,
  viewpoint: { id: 'overview', seq: 0 },
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setCutaway: (cutaway) => set({ cutaway }),
  setShowCollider: (showCollider) => set({ showCollider }),
  goTo: (id) =>
    set((state) => ({ cameraMode: 'free', viewpoint: { id, seq: state.viewpoint.seq + 1 } })),
}));

/**
 * Where per-frame numbers are written. The game loop pushes text straight into these elements;
 * going through React state would re-render the overlay sixty times a second.
 */
export const statsSink: { element: HTMLElement | null } = { element: null };
export const playerSink: { element: HTMLElement | null } = { element: null };
