// No zod here: this module is part of the splash screen chunk, which must stay small.

const STORAGE_KEY = 'campus.guest.v1';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface Guest {
  id: string;
  name: string;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
}

/**
 * The development identity of this browser (docs/DECISIONS.md, P2.1): a random id that stays the
 * same between visits and the name the player typed. Replaced by real sign-in in P3.
 */
export function loadGuest(): Guest {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<Guest> | null;
    if (stored && typeof stored.id === 'string' && ID_PATTERN.test(stored.id)) {
      return { id: stored.id, name: typeof stored.name === 'string' ? stored.name : '' };
    }
  } catch {
    // Unreadable storage: start over with a new id.
  }
  return { id: randomId(), name: '' };
}

export function saveGuest(guest: Guest): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(guest));
  } catch {
    // Private mode: the id changes next visit, which only costs the old session.
  }
}

/** A friendly default when someone enters without typing a name. */
export function fallbackName(id: string): string {
  return `Khách ${id.slice(0, 4).toUpperCase()}`;
}

/** Validation message for a typed name, or null when it is fine. Mirrors the server's rule. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Hãy nhập tên hiển thị.';
  if (trimmed.length > 24) return 'Tên dài tối đa 24 ký tự.';
  if (/[<>]/.test(trimmed)) return 'Tên không được chứa < hoặc >.';
  return null;
}
