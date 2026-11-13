import type { MapIndex } from '@campus/map-data';
import type { MissionDefinition, ObjectiveOf, ObjectiveType } from '@campus/shared';

/** What happens in the world, as the realtime server reports it (docs/06 §5.1). */
export type GameEvent =
  /** `areaId` is an area id, or a POI id when the player came within a POI target's radius. */
  | { type: 'area.entered' | 'area.left'; userId: string; areaId: string }
  | { type: 'area.dwell'; userId: string; areaId: string; seconds: number }
  | { type: 'entity.interacted'; userId: string; entityId: string; action?: string }
  /** `nearbyUserIds`: everyone within the objective's reach, measured by the server. */
  | { type: 'emote.performed'; userId: string; emote: string; nearbyUserIds: string[] }
  /** `correct` is decided by the server from the question bank, never by the client. */
  | {
      type: 'quiz.answered';
      userId: string;
      questionId: string;
      choice: number;
      correct: boolean;
    }
  | { type: 'seat.taken'; userId: string; seatId: string }
  | { type: 'tick'; roomId: string };

export type GameEventType = GameEvent['type'];

/** A mission thing placed in the world: an item to pick up, a kiosk to talk to. */
export interface EntitySpec {
  /** Unique within the mission: `<objective id>:<poi id>`. */
  id: string;
  objectiveId: string;
  kind: 'item' | 'kiosk';
  /** Where it stands. */
  poiId: string;
  /** For items: what it looks like (`coffee_cup`). */
  item?: string;
}

/** Picks quiz questions; the realtime server backs it with the question bank. */
export interface QuestionPicker {
  pick(from: { questionIds: string[] } | { tags: string[]; pick: number }, seed: string): string[];
}

/** What a handler may know besides its own parameters and state. */
export interface MissionCtx {
  missionId: string;
  mission: MissionDefinition;
  map: MapIndex;
  questions?: QuestionPicker;
}

/** The person whose progress is being worked out. */
export interface PlayerRef {
  userId: string;
}

/**
 * One kind of objective (docs/06 §5.2). Handlers are almost pure: old state plus an event gives
 * new state, so they are tested without a server or a browser.
 */
export interface ObjectiveHandler<T extends ObjectiveType, S> {
  type: T;
  events: readonly GameEventType[];
  init(ctx: MissionCtx, objective: ObjectiveOf<T>, player: PlayerRef): S;
  /** The new state and count, or null when the event changes nothing. */
  onEvent(
    ctx: MissionCtx,
    objective: ObjectiveOf<T>,
    state: S,
    event: GameEvent,
    player: PlayerRef,
  ): { state: S; current: number } | null;
  /** Entities everyone sees. */
  sharedEntities?(ctx: MissionCtx, objective: ObjectiveOf<T>): EntitySpec[];
  /** Entities only this player sees (and that are still there for them). */
  privateEntities?(
    ctx: MissionCtx,
    objective: ObjectiveOf<T>,
    state: S,
    player: PlayerRef,
  ): EntitySpec[];
  /** What may be shown to the player: never answers. */
  clientView(objective: ObjectiveOf<T>, state: S): unknown;
}

/** A deterministic shuffle from a string seed (FNV-1a + xorshift), stable across processes. */
export function seededOrder<T>(items: readonly T[], seed: string): T[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const next = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return (hash >>> 0) / 4294967296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}
