/**
 * Raw input shared between the DOM (which writes it) and the game loop (which reads it once per
 * frame). A plain mutable object on purpose: nothing here should ever trigger a React render.
 */
export const input = {
  /** Keys currently held, by `KeyboardEvent.code`. */
  keys: new Set<string>(),
  /** On-screen joystick, -1..1 on each axis; x is right, y is forward. */
  stick: { active: false, x: 0, y: 0 },
  /** Set when jump is pressed; the game loop clears it once consumed. */
  jump: false,
  /** EMOTES id requested this frame, 0 for none; consumed by the game loop. */
  emote: 0,
  /** Set when the interact key or button is pressed; consumed by the game loop. */
  interact: false,
  /** Camera drag since the last frame, in pixels. */
  lookX: 0,
  lookY: 0,
  /** Zoom request since the last frame: positive moves the camera away. */
  zoom: 0,
};

const pressed = (...codes: string[]) => codes.some((code) => input.keys.has(code));

/** Movement the player is asking for: x to the right, y forward, each in -1..1. */
export function readMove(): { x: number; y: number; run: boolean } {
  if (input.stick.active) {
    const strength = Math.hypot(input.stick.x, input.stick.y);
    // Pushing the stick all the way out is how you run on a touch screen.
    return { x: input.stick.x, y: input.stick.y, run: strength > 0.85 };
  }
  const x = (pressed('KeyD', 'ArrowRight') ? 1 : 0) - (pressed('KeyA', 'ArrowLeft') ? 1 : 0);
  const y = (pressed('KeyW', 'ArrowUp') ? 1 : 0) - (pressed('KeyS', 'ArrowDown') ? 1 : 0);
  return { x, y, run: pressed('ShiftLeft', 'ShiftRight') };
}

/** Drops everything that is held, for when the window loses focus mid-press. */
export function releaseAll(): void {
  input.keys.clear();
  input.stick.active = false;
  input.stick.x = 0;
  input.stick.y = 0;
}
