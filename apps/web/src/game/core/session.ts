import { create } from 'zustand';
import type { QualityLevel } from './quality';

export type Phase = 'loading' | 'building' | 'ready' | 'playing';

export type NetStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'replaced';

export interface NetSummary {
  status: NetStatus;
  /** Channel number shown to the player, once joined. */
  channel: number | null;
  /** People in this channel, including the player. */
  players: number;
}

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
  /** What the player can do right here, offered as a button / the E key. */
  prompt: { seatId: string; label: string } | null;
  /** A short message from the game, shown for a moment. `id` changes with every message. */
  notice: { text: string; id: number } | null;
  setPrompt(prompt: { seatId: string; label: string } | null): void;
  showNotice(text: string): void;
  /** Name the player typed on the splash screen. */
  displayName: string;
  net: NetSummary;
  setPhase(phase: Phase): void;
  setDisplayName(name: string): void;
  setNet(patch: Partial<NetSummary>): void;
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
  prompt: null,
  notice: null,
  setPrompt: (prompt) => set({ prompt }),
  showNotice: (text) => set((state) => ({ notice: { text, id: (state.notice?.id ?? 0) + 1 } })),
  displayName: '',
  net: { status: 'idle', channel: null, players: 0 },
  setPhase: (phase) => set({ phase }),
  setDisplayName: (displayName) => set({ displayName }),
  setNet: (patch) => set((state) => ({ net: { ...state.net, ...patch } })),
  markWorldReady() {
    if (get().worldReadyMs !== null) return;
    const ms = Math.round(performance.now());
    console.info(`[campus] world ready after ${ms} ms`);
    set({ worldReadyMs: ms, phase: 'ready' });
  },
  setLocation: (location) => set({ location }),
  setQuality: (level, dpr) => set({ quality: { level, dpr } }),
}));

/**
 * Per-frame values for the HUD. The game loop calls these directly, so the minimap moves without
 * a React render.
 */
export const hudSink: {
  /** Feet position, body yaw, floor, and the camera heading (the minimap turns with it). */
  player: ((x: number, z: number, yaw: number, floor: string, heading: number) => void) | null;
} = { player: null };
