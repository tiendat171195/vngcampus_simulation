import { create } from 'zustand';
import type { QualitySetting } from './quality';

const STORAGE_KEY = 'campus.settings.v1';

export interface Settings {
  quality: QualitySetting;
  /** Multiplier on camera turn speed. */
  lookSensitivity: number;
  showHints: boolean;
}

const DEFAULTS: Settings = { quality: 'auto', lookSensitivity: 1, showHints: true };

function load(): Settings {
  const fromUrl = new URLSearchParams(window.location.search).get('quality');
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    // Private mode or blocked storage: settings simply do not persist.
  }
  const settings = { ...DEFAULTS, ...stored };
  if (fromUrl === 'auto' || fromUrl === 'low' || fromUrl === 'medium' || fromUrl === 'high') {
    settings.quality = fromUrl;
  }
  return settings;
}

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
}

/** Per-viewer preferences, remembered in this browser only. */
export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    const { quality, lookSensitivity, showHints } = get();
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ quality, lookSensitivity, showHints }),
      );
    } catch {
      // Ignore: see load().
    }
  },
}));
