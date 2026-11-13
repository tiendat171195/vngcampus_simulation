/**
 * The three first steps of a first visit (docs/01 §4.1): walk, look around, wave. The game loop
 * writes what the player has done here every frame; the tutorial card reads it a few times a
 * second. Done once per browser.
 */
export const tutorialSink = {
  /** Metres walked since the tutorial started. */
  walked: 0,
  /** Radians the camera has turned. */
  turned: 0,
  waved: false,
};

const KEY = 'campus.tutorial.v1';

export function tutorialDone(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'done';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    window.localStorage.setItem(KEY, 'done');
  } catch {
    // Private mode: the tutorial shows again next visit.
  }
}

export function resetTutorialSink(): void {
  tutorialSink.walked = 0;
  tutorialSink.turned = 0;
  tutorialSink.waved = false;
}

const FIRST_RUN_KEY = 'campus.firstrun.v1';

/** Whether this browser has been through the first visit (avatar choice, then the tutorial). */
export function firstRunDone(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_KEY) === 'done';
  } catch {
    return true;
  }
}

export function markFirstRunDone(): void {
  try {
    window.localStorage.setItem(FIRST_RUN_KEY, 'done');
  } catch {
    // Private mode: nothing to remember.
  }
}
