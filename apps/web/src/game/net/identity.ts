// No zod here: this module is part of the splash screen chunk, which must stay small.

const STORAGE_KEY = 'campus.name.v1';
/** Before P3.1 the browser kept a self-made guest id next to the name; only the name is reused. */
const LEGACY_KEY = 'campus.guest.v1';

/**
 * The display name this browser last entered with, to prefill the splash screen. Who the player
 * is lives on the server (services/auth.ts); this is only a convenience.
 */
export function loadName(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored;
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? 'null') as {
      name?: unknown;
    } | null;
    return typeof legacy?.name === 'string' ? legacy.name : '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Private mode: the splash screen just starts empty next time.
  }
}

/** Validation message for a typed name, or null when it is fine. Mirrors the server's rule. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Hãy nhập tên hiển thị.';
  if (trimmed.length > 24) return 'Tên dài tối đa 24 ký tự.';
  if (/[<>]/.test(trimmed)) return 'Tên không được chứa < hoặc >.';
  return null;
}
