/**
 * Rendering quality (docs/04-client.md §4). No three.js imports: the splash screen and settings
 * read this before the 3D code has loaded.
 */

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityLevel;

export interface QualityPreset {
  label: string;
  /** Distance where the fog fully hides the world; the camera's far plane sits just past it. */
  viewDistance: number;
  /** Bots and remote avatars closer than this animate every frame. */
  fullAnimationDistance: number;
  /** Between fullAnimationDistance and this, avatars animate at 15 Hz; beyond, at 5 Hz. */
  reducedAnimationDistance: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { label: 'Thấp', viewDistance: 140, fullAnimationDistance: 8, reducedAnimationDistance: 25 },
  medium: {
    label: 'Trung bình',
    viewDistance: 220,
    fullAnimationDistance: 12,
    reducedAnimationDistance: 35,
  },
  high: {
    label: 'Cao',
    viewDistance: 400,
    fullAnimationDistance: 18,
    reducedAnimationDistance: 50,
  },
};

/** One step of the automatic ladder: a quality level at a pixel ratio. */
export interface Rung {
  level: QualityLevel;
  dpr: number;
}

/** From cheapest to most expensive. Auto quality moves one rung at a time. */
export const LADDER: readonly Rung[] = [
  { level: 'low', dpr: 0.75 },
  { level: 'low', dpr: 1 },
  { level: 'medium', dpr: 1 },
  { level: 'medium', dpr: 1.25 },
  { level: 'medium', dpr: 1.5 },
  { level: 'high', dpr: 1.5 },
  { level: 'high', dpr: 1.75 },
  { level: 'high', dpr: 2 },
];

/** Pixel ratio used when the player fixes a level by hand. */
export const FIXED_DPR: Record<QualityLevel, number> = { low: 1, medium: 1.5, high: 2 };

export interface DeviceHints {
  /** `WebGLRenderingContext.RENDERER`, unmasked if the browser allows it. */
  renderer: string;
  touch: boolean;
  cores: number;
}

/** First guess before any frame has been timed. */
export function initialRung(hints: DeviceHints): number {
  const index = (level: QualityLevel, dpr: number) =>
    LADDER.findIndex((rung) => rung.level === level && rung.dpr === dpr);
  if (/swiftshader|llvmpipe|software|basic render/i.test(hints.renderer)) return index('low', 0.75);
  if (hints.touch) return hints.cores >= 8 ? index('medium', 1.25) : index('medium', 1);
  return index('high', 1.5);
}

const SLOW_FPS = 28;
const FAST_FPS = 55;
const SLOW_WINDOW = 2;
const FAST_WINDOW = 5;
/** After dropping from a rung, do not climb back onto it for this long. */
const CEILING_SECONDS = 60;
/** Frames longer than this (tab switch, GC pause, shader compile) are ignored. */
const HITCH = 0.25;

/**
 * Watches frame times and moves along the ladder: down after two slow seconds, up after five
 * fast ones. A rung that had to be left is not retried for a minute, so quality does not
 * oscillate between two settings.
 */
export class QualityGovernor {
  rung: number;
  private elapsed = 0;
  private frames = 0;
  private ceiling: number = LADDER.length - 1;
  private ceilingFor = 0;

  constructor(start: number) {
    this.rung = Math.min(LADDER.length - 1, Math.max(0, start));
  }

  get current(): Rung {
    return LADDER[this.rung] as Rung;
  }

  /** Feeds one frame. Returns true when the rung changed. */
  sample(dt: number): boolean {
    if (dt > HITCH) return false;
    this.elapsed += dt;
    this.frames += 1;
    if (this.ceilingFor > 0) {
      this.ceilingFor -= dt;
      if (this.ceilingFor <= 0) this.ceiling = LADDER.length - 1;
    }

    const fps = this.frames / this.elapsed;
    if (this.elapsed >= SLOW_WINDOW && fps < SLOW_FPS) {
      this.reset();
      if (this.rung === 0) return false;
      this.ceiling = this.rung - 1;
      this.ceilingFor = CEILING_SECONDS;
      this.rung -= 1;
      return true;
    }
    if (this.elapsed >= FAST_WINDOW) {
      const climb = fps > FAST_FPS && this.rung < this.ceiling;
      this.reset();
      if (climb) {
        this.rung += 1;
        return true;
      }
    }
    // A window that is neither clearly slow nor long enough to call fast keeps going, but a
    // window that has been mediocre for a while starts over so old frames stop counting.
    if (this.elapsed >= FAST_WINDOW) this.reset();
    return false;
  }

  private reset(): void {
    this.elapsed = 0;
    this.frames = 0;
  }
}
