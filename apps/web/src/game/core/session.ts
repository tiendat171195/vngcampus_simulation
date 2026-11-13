import { create } from 'zustand';
import type { QualityLevel } from './quality';

export type Phase = 'loading' | 'building' | 'ready' | 'playing';

export interface PlayerLocation {
  areaId: string;
  name: string;
  floorLabel: string;
}

interface SessionState {
  phase: Phase;
  /** Milliseconds from navigation start until the first frame of the world was drawn. */
  worldReadyMs: number | null;
  /** Where the player is, updated only when it changes. */
  location: PlayerLocation | null;
  /** Effective quality, after auto adjustment. */
  quality: { level: QualityLevel; dpr: number };
  setPhase(phase: Phase): void;
  markWorldReady(): void;
  setLocation(location: PlayerLocation): void;
  setQuality(level: QualityLevel, dpr: number): void;
}

/** App-wide state that changes rarely. Per-frame data never goes here. */
export const useSession = create<SessionState>((set, get) => ({
  phase: 'loading',
  worldReadyMs: null,
  location: null,
  quality: { level: 'medium', dpr: 1 },
  setPhase: (phase) => set({ phase }),
  markWorldReady() {
    if (get().worldReadyMs !== null) return;
    const ms = Math.round(performance.now());
    console.info(`[campus] world ready after ${ms} ms`);
    const autoEnter = new URLSearchParams(window.location.search).has('enter');
    set({ worldReadyMs: ms, phase: autoEnter ? 'playing' : 'ready' });
  },
  setLocation: (location) => set({ location }),
  setQuality: (level, dpr) => set({ quality: { level, dpr } }),
}));

/**
 * Per-frame values for the HUD. The game loop calls these directly, so the minimap moves without
 * a React render.
 */
export const hudSink: {
  player: ((x: number, z: number, yaw: number, floor: string) => void) | null;
} = { player: null };
