import { create } from 'zustand';
import type { LevelId } from '../world/context';

export type ViewpointId =
  | 'overview'
  | 'gate'
  | 'lobby'
  | 'atrium'
  | 'bleachers'
  | 'canteen'
  | 'gym'
  | 'office'
  | 'pool'
  | 'riverside'
  | 'forecourt';

interface DebugState {
  /** `follow` is the game camera behind the character; `free` detaches it for inspection. */
  cameraMode: 'follow' | 'free';
  /** Highest storey drawn; everything above is hidden to look inside the buildings. */
  cutaway: LevelId;
  showCollider: boolean;
  /** Number of fake wandering avatars, for crowd performance checks. `?bots=N` sets it. */
  bots: number;
  /** The viewpoint last asked for. `seq` changes on every request, so asking twice works. */
  viewpoint: { id: ViewpointId; seq: number };
  /**
   * A standing point of the photo survey (`T1-02.S1`, docs/12-photo-survey.md) to put the free
   * camera at, at eye height, to compare the map with the photo taken there. `?station=` sets it.
   */
  station: { id: string; seq: number } | null;
  setCameraMode(mode: 'follow' | 'free'): void;
  setCutaway(level: LevelId): void;
  setShowCollider(value: boolean): void;
  setBots(count: number): void;
  /** Detaches the camera and moves it to a preset viewpoint. */
  goTo(id: ViewpointId): void;
  /** Detaches the camera and stands it at a survey station. */
  goToStation(id: string): void;
}

const requestedStation = new URLSearchParams(window.location.search).get('station');

export const useDebugStore = create<DebugState>((set) => ({
  cameraMode: requestedStation ? 'free' : 'follow',
  cutaway: 'ROOF',
  showCollider: false,
  bots: Math.max(
    0,
    Math.min(300, Number(new URLSearchParams(window.location.search).get('bots')) || 0),
  ),
  viewpoint: { id: 'overview', seq: 0 },
  station: requestedStation ? { id: requestedStation, seq: 0 } : null,
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setCutaway: (cutaway) => set({ cutaway }),
  setShowCollider: (showCollider) => set({ showCollider }),
  setBots: (bots) => set({ bots }),
  goTo: (id) =>
    set((state) => ({ cameraMode: 'free', viewpoint: { id, seq: state.viewpoint.seq + 1 } })),
  goToStation: (id) =>
    set((state) => ({
      cameraMode: 'free',
      station: { id, seq: (state.station?.seq ?? 0) + 1 },
    })),
}));

/**
 * Where per-frame numbers are written. The game loop pushes text straight into these elements;
 * going through React state would re-render the overlay sixty times a second.
 */
export const statsSink: { element: HTMLElement | null } = { element: null };
export const playerSink: { element: HTMLElement | null } = { element: null };
