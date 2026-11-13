import {
  type ActiveMission,
  applyEvent,
  type EntitySpec,
  entitiesFor,
  type GameEvent,
  type MissionCtx,
  type Progress,
  progressView,
  startProgress,
  sumRewards,
  watchedPlaces,
} from '@campus/core';
import { areasAt, floorAt, type MapIndex } from '@campus/map-data';
import { campusIndex } from '@campus/map-data/campus';
import {
  INTERACT_RANGE,
  type MissionCompletedMessage,
  type MissionEntitiesMessage,
  type MissionEntity,
  type MissionProgressMessage,
  type MissionStateMessage,
  type MissionView,
  MSG,
  type ObjectiveView,
  type QuizQuestionMessage,
  type QuizResultMessage,
} from '@campus/shared';
import type { MissionRuntime } from './runtime';

/** What the binding needs from the room; the room is the only thing that talks to clients. */
export interface RoomHooks {
  send(sessionId: string, type: string, payload: unknown): void;
  broadcast(type: string, payload: unknown): void;
  /** The last position the server accepted for this player, metres. */
  position(sessionId: string): { x: number; y: number; z: number } | null;
  /** Everyone in the room, for emotes towards colleagues. */
  players(): Iterable<{ sessionId: string; userId: string }>;
  now(): number;
}

interface MissionSlot {
  progress: Progress;
  /** When the first progress was made; null until then (docs/06 §3). */
  startedAt: Date | null;
  completed: boolean;
}

interface PlayerMissions {
  userId: string;
  name: string;
  /** False until progress has been loaded; events wait for it. */
  ready: Promise<void>;
  slots: Map<string, MissionSlot>;
  /** Watched places the player is inside, with when they arrived (room clock, ms). */
  inside: Map<string, number>;
  /** One write at a time per player: progress has a single writer (docs/06 §5.3). */
  queue: Promise<void>;
  lastInteract: number;
}

/** A place a visit objective watches: an area, or a POI with a radius. */
type Watched =
  | { id: string; kind: 'area' }
  | { id: string; kind: 'poi'; x: number; z: number; floor: string; radius: number };

const INTERACT_INTERVAL_MS = 250;
const TOAST_INTERVAL_MS = 5000;

/**
 * Runs the missions in one room (docs/06 §5.3): turns what players do into game events, feeds
 * them to the engine, saves progress before telling anyone, and places mission entities.
 */
export class RoomMissionBinding {
  private readonly players = new Map<string, PlayerMissions>();
  /** Shared items someone took, until when (room clock); Infinity when they do not come back. */
  private readonly taken = new Map<string, number>();
  private watched: Watched[] = [];
  private lastToast = Number.NEGATIVE_INFINITY;
  private readonly unsubscribe: () => void;

  private readonly runtime: MissionRuntime;
  private readonly hooks: RoomHooks;
  private readonly map: MapIndex;

  constructor(runtime: MissionRuntime, hooks: RoomHooks, map: MapIndex = campusIndex) {
    this.runtime = runtime;
    this.hooks = hooks;
    this.map = map;
    this.unsubscribe = runtime.subscribe(() => void this.missionsChanged());
    this.watch();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private ctx(mission: ActiveMission): MissionCtx {
    return {
      missionId: mission.id,
      mission: mission.definition,
      map: this.map,
      questions: this.runtime.bank,
    };
  }

  /** Running missions, minus any whose end has passed since the last refresh. */
  private running(): ActiveMission[] {
    const now = Date.now();
    return this.runtime.missions.filter((mission) => mission.endsAt.getTime() > now);
  }

  // ---------- players ----------

  /** Loads the player's progress (they may be coming back) and sends their mission state. */
  join(sessionId: string, userId: string, name: string): Promise<void> {
    const player: PlayerMissions = {
      userId,
      name,
      ready: Promise.resolve(),
      slots: new Map(),
      inside: new Map(),
      queue: Promise.resolve(),
      lastInteract: Number.NEGATIVE_INFINITY,
    };
    this.players.set(sessionId, player);
    player.ready = this.loadSlots(player).then(() => {
      if (this.players.get(sessionId) !== player) return;
      this.sendState(sessionId);
      this.move(sessionId);
    });
    player.queue = player.ready;
    return player.ready;
  }

  leave(sessionId: string): void {
    this.players.delete(sessionId);
  }

  private async loadSlots(player: PlayerMissions): Promise<void> {
    for (const mission of this.running()) {
      if (player.slots.has(mission.id)) continue;
      // Guest ids from development identities are not database users.
      const stored = isUuid(player.userId)
        ? await this.runtime.source.loadProgress(mission.id, player.userId).catch(() => null)
        : null;
      player.slots.set(mission.id, {
        progress: stored?.progress ?? startProgress(this.ctx(mission), { userId: player.userId }),
        startedAt: stored?.startedAt ?? null,
        completed: Boolean(stored?.completedAt),
      });
    }
  }

  /** The set of running missions changed: new ones get entities and slots, ended ones go away. */
  private async missionsChanged(): Promise<void> {
    this.watch();
    const ids = new Set(this.runtime.missions.map((mission) => mission.id));
    for (const [sessionId, player] of this.players) {
      for (const id of player.slots.keys()) if (!ids.has(id)) player.slots.delete(id);
      await this.loadSlots(player);
      this.sendState(sessionId);
    }
  }

  private watch(): void {
    const ids = new Set(this.running().flatMap((mission) => watchedPlaces(mission.definition)));
    this.watched = [];
    for (const id of ids) {
      if (this.map.areas.has(id)) this.watched.push({ id, kind: 'area' });
      const poi = this.map.pois.get(id);
      if (!poi) continue;
      const radius =
        this.running()
          .flatMap((mission) => mission.definition.objectives)
          .flatMap((objective) => (objective.type === 'visit' ? objective.params.targets : []))
          .find((target) => 'poiId' in target && target.poiId === id) ?? null;
      this.watched.push({
        id,
        kind: 'poi',
        x: poi.position[0],
        z: poi.position[1],
        floor: poi.floor,
        radius: radius && 'radius' in radius ? radius.radius : 3,
      });
    }
  }

  // ---------- events from the room ----------

  /** After an accepted move: entering and leaving the watched places (docs/06 §5.1). */
  move(sessionId: string): void {
    const player = this.players.get(sessionId);
    const at = this.hooks.position(sessionId);
    if (!player || !at || this.watched.length === 0) return;
    const floor = floorAt(this.map, at.y);
    const areas = new Set(areasAt(this.map, [at.x, at.z], floor).map((area) => area.id));
    const now = this.hooks.now();
    for (const place of this.watched) {
      const inside =
        place.kind === 'area'
          ? areas.has(place.id)
          : place.floor === floor && Math.hypot(at.x - place.x, at.z - place.z) <= place.radius;
      const was = player.inside.has(place.id);
      if (inside && !was) {
        player.inside.set(place.id, now);
        void this.process(sessionId, {
          type: 'area.entered',
          userId: player.userId,
          areaId: place.id,
        });
      } else if (!inside && was) {
        player.inside.delete(place.id);
        void this.process(sessionId, {
          type: 'area.left',
          userId: player.userId,
          areaId: place.id,
        });
      }
    }
  }

  /** Once a second: time spent in watched places, and shared items coming back. */
  tick(): void {
    const now = this.hooks.now();
    for (const [sessionId, player] of this.players)
      for (const [areaId, since] of player.inside)
        void this.process(sessionId, {
          type: 'area.dwell',
          userId: player.userId,
          areaId,
          seconds: Math.floor((now - since) / 1000),
        });
    let returned = false;
    for (const [id, until] of this.taken)
      if (until <= now) {
        this.taken.delete(id);
        returned = true;
      }
    if (returned) for (const sessionId of this.players.keys()) this.sendEntities(sessionId);
  }

  /** An emote: colleagues around, with their distances, for `social` objectives. */
  emote(sessionId: string, emote: string): void {
    const player = this.players.get(sessionId);
    const at = this.hooks.position(sessionId);
    if (!player || !at) return;
    const nearby: Array<{ userId: string; distance: number }> = [];
    for (const other of this.hooks.players()) {
      if (other.sessionId === sessionId) continue;
      const there = this.hooks.position(other.sessionId);
      if (!there || Math.abs(there.y - at.y) > 2) continue;
      const distance = Math.hypot(there.x - at.x, there.z - at.z);
      if (distance <= 15) nearby.push({ userId: other.userId, distance });
    }
    if (nearby.length > 0)
      void this.process(sessionId, {
        type: 'emote.performed',
        userId: player.userId,
        emote,
        nearby,
      });
  }

  /**
   * Using a mission entity. Returns a message for the player when it cannot be used (too far,
   * already taken), or null.
   */
  async interact(sessionId: string, entityId: string): Promise<string | null> {
    const player = this.players.get(sessionId);
    const at = this.hooks.position(sessionId);
    if (!player || !at) return null;
    const now = this.hooks.now();
    if (now - player.lastInteract < INTERACT_INTERVAL_MS) return null;
    player.lastInteract = now;
    await player.ready;
    const entity = this.visibleEntities(player).find((candidate) => candidate.id === entityId);
    if (!entity) return 'Vật này không còn ở đây.';
    if (
      Math.abs(entity.y - at.y) > 2 ||
      Math.hypot(entity.x - at.x, entity.z - at.z) > INTERACT_RANGE
    )
      return 'Lại gần hơn một chút.';

    const mission = this.running().find((candidate) => candidate.id === entity.missionId);
    const objective = mission?.definition.objectives.find((o) => o.id === entity.objectiveId);
    if (!mission || !objective) return null;
    const sharedItem =
      entity.kind === 'item' && objective.type === 'collect' && objective.params.scope === 'shared';
    if (sharedItem) {
      // First come, first served: taken before the write so nobody else gets it meanwhile.
      const respawn = objective.params.respawnSec;
      this.taken.set(entity.id, respawn ? now + respawn * 1000 : Number.POSITIVE_INFINITY);
    }
    const changed = await this.process(sessionId, {
      type: 'entity.interacted',
      userId: player.userId,
      entityId: entity.id,
    });
    if (sharedItem) {
      if (!changed) this.taken.delete(entity.id);
      else
        for (const other of this.players.keys()) if (other !== sessionId) this.sendEntities(other);
    }
    if (entity.kind === 'kiosk') this.sendQuestion(sessionId, mission, objective.id);
    return null;
  }

  /** An answer at a kiosk; right or wrong is decided here, from the bank. */
  async answer(
    sessionId: string,
    input: { missionId: string; objectiveId: string; questionId: string; choice: number },
  ): Promise<void> {
    const player = this.players.get(sessionId);
    if (!player) return;
    await player.ready;
    const mission = this.running().find((candidate) => candidate.id === input.missionId);
    const slot = player.slots.get(input.missionId);
    if (!mission || !slot) return;
    const asked = this.currentQuestion(mission, slot, input.objectiveId);
    if (asked !== input.questionId) return;
    const question = this.runtime.bank.get(input.questionId);
    if (!question) return;
    const correct = input.choice === question.correctIndex;
    await this.process(sessionId, {
      type: 'quiz.answered',
      userId: player.userId,
      questionId: input.questionId,
      choice: input.choice,
      correct,
    });
    const after = player.slots.get(input.missionId);
    const next = after ? this.currentQuestion(mission, after, input.objectiveId) : null;
    this.hooks.send(sessionId, MSG.quizResult, {
      missionId: mission.id,
      objectiveId: input.objectiveId,
      questionId: input.questionId,
      correct,
      ...(correct && question.explanation ? { explanation: question.explanation } : {}),
      finished: next === null,
    } satisfies QuizResultMessage);
    if (next) this.sendQuestion(sessionId, mission, input.objectiveId);
  }

  // ---------- the engine ----------

  /**
   * Feeds one event to every running mission of the player. Progress is saved before it is
   * shown (docs/06 §5.4); if saving fails nothing changes and the player can try again.
   * Resolves to whether any progress changed.
   */
  private process(sessionId: string, event: GameEvent): Promise<boolean> {
    const player = this.players.get(sessionId);
    if (!player) return Promise.resolve(false);
    let changedAny = false;
    const run = async () => {
      for (const mission of this.running()) {
        const slot = player.slots.get(mission.id);
        if (!slot || slot.completed) continue;
        const outcome = applyEvent(this.ctx(mission), slot.progress, event, {
          userId: player.userId,
        });
        if (!outcome) continue;
        const startedAt = slot.startedAt ?? new Date();
        const persistent = isUuid(player.userId);
        try {
          if (outcome.completed) {
            const result = persistent
              ? await this.runtime.source.complete({
                  mission,
                  userId: player.userId,
                  progress: outcome.progress,
                  startedAt,
                })
              : null;
            slot.completed = true;
            this.commit(sessionId, mission, slot, outcome.progress, startedAt, outcome.changed);
            this.hooks.send(sessionId, MSG.missionCompleted, {
              missionId: mission.id,
              title: mission.definition.title,
              points: result?.points ?? 0,
              xp: result?.xp ?? 0,
              multiplier: result?.multiplier ?? 1,
              streak: result?.streak ?? null,
              streakBonus: result?.streakBonus ?? 0,
              level: result?.level ?? 1,
              durationMs: result?.durationMs ?? Date.now() - startedAt.getTime(),
            } satisfies MissionCompletedMessage);
            this.toast(`${player.name} vừa hoàn thành nhiệm vụ "${mission.definition.title.vi}"!`);
          } else {
            if (persistent)
              await this.runtime.source.saveProgress({
                missionId: mission.id,
                userId: player.userId,
                progress: outcome.progress,
                startedAt,
              });
            this.commit(sessionId, mission, slot, outcome.progress, startedAt, outcome.changed);
          }
          changedAny = true;
        } catch (error) {
          console.warn(`[missions] progress not saved for ${player.userId}: ${String(error)}`);
        }
      }
    };
    const done = player.queue.then(run, run);
    player.queue = done.catch(() => {});
    return done.then(() => changedAny);
  }

  /** The new progress is saved: keep it, and tell the player. */
  private commit(
    sessionId: string,
    mission: ActiveMission,
    slot: MissionSlot,
    progress: Progress,
    startedAt: Date,
    changed: string[],
  ): void {
    slot.progress = progress;
    slot.startedAt = startedAt;
    const views = this.objectiveViews(mission, slot);
    for (const id of changed) {
      const objective = views.find((view) => view.id === id);
      if (objective)
        this.hooks.send(sessionId, MSG.missionProgress, {
          missionId: mission.id,
          objective,
        } satisfies MissionProgressMessage);
    }
    // Picked items disappear for the player; a finished mission takes its entities away.
    this.sendEntities(sessionId);
  }

  // ---------- what players see ----------

  private objectiveViews(mission: ActiveMission, slot: MissionSlot): ObjectiveView[] {
    const views = progressView(mission.definition, slot.progress);
    return mission.definition.objectives.map((objective, i) => ({
      id: objective.id,
      type: objective.type,
      title: objective.title,
      ...(objective.hint ? { hint: objective.hint } : {}),
      current: views[i]?.current ?? 0,
      target: objective.target,
      done: views[i]?.done ?? false,
      optional: objective.optional,
      view: views[i]?.view ?? null,
    }));
  }

  private sendState(sessionId: string): void {
    const player = this.players.get(sessionId);
    if (!player) return;
    const missions: MissionView[] = [];
    for (const mission of this.running()) {
      const slot = player.slots.get(mission.id);
      if (!slot) continue;
      const def = mission.definition;
      missions.push({
        id: mission.id,
        kind: mission.kind,
        title: def.title,
        description: def.description,
        startsAt: mission.startsAt.toISOString(),
        endsAt: mission.endsAt.toISOString(),
        objectiveMode: def.objectiveMode,
        objectives: this.objectiveViews(mission, slot),
        rewards: sumRewards(def.rewards),
        completed: slot.completed,
      });
    }
    this.hooks.send(sessionId, MSG.missionState, { missions } satisfies MissionStateMessage);
    this.sendEntities(sessionId);
  }

  /** Entities this player can see now: shared ones still there, and their own. */
  private visibleEntities(player: PlayerMissions): MissionEntity[] {
    const entities: MissionEntity[] = [];
    for (const mission of this.running()) {
      const slot = player.slots.get(mission.id);
      if (!slot || slot.completed) continue;
      const { shared, own } = entitiesFor(this.ctx(mission), slot.progress, {
        userId: player.userId,
      });
      const done = new Set(
        mission.definition.objectives.filter((o) => slot.progress[o.id]?.done).map((o) => o.id),
      );
      for (const spec of [...shared, ...own]) {
        if (done.has(spec.objectiveId) || this.taken.has(spec.id)) continue;
        // A shared item this player already picked is gone for them.
        if (spec.kind === 'item' && pickedBy(slot.progress, spec)) continue;
        const placed = this.place(mission.id, spec);
        if (placed) entities.push(placed);
      }
    }
    return entities;
  }

  private place(missionId: string, spec: EntitySpec): MissionEntity | null {
    const poi = this.map.pois.get(spec.poiId);
    if (!poi) return null;
    return {
      id: spec.id,
      missionId,
      objectiveId: spec.objectiveId,
      kind: spec.kind,
      ...(spec.item ? { item: spec.item } : {}),
      x: poi.position[0],
      y: this.map.floors.get(poi.floor)?.y ?? 0,
      z: poi.position[1],
    };
  }

  private sendEntities(sessionId: string): void {
    const player = this.players.get(sessionId);
    if (!player) return;
    this.hooks.send(sessionId, MSG.missionEntities, {
      entities: this.visibleEntities(player),
    } satisfies MissionEntitiesMessage);
  }

  private currentQuestion(
    mission: ActiveMission,
    slot: MissionSlot,
    objectiveId: string,
  ): string | null {
    const view = this.objectiveViews(mission, slot).find(
      (objective) => objective.id === objectiveId,
    );
    if (view?.type !== 'quiz' || view.done) return null;
    return (view.view as { questionId: string | null } | null)?.questionId ?? null;
  }

  private sendQuestion(sessionId: string, mission: ActiveMission, objectiveId: string): void {
    const player = this.players.get(sessionId);
    const slot = player?.slots.get(mission.id);
    if (!slot) return;
    const view = this.objectiveViews(mission, slot).find(
      (objective) => objective.id === objectiveId,
    );
    const state = view?.view as {
      questionId: string | null;
      asked: number;
      total: number;
      triesLeft: number;
    } | null;
    const question = state?.questionId ? this.runtime.bank.get(state.questionId) : undefined;
    if (!state || !question || view?.done) return;
    this.hooks.send(sessionId, MSG.quizQuestion, {
      missionId: mission.id,
      objectiveId,
      questionId: question.id,
      text: question.text,
      choices: question.choices,
      index: state.asked + 1,
      total: state.total,
      triesLeft: state.triesLeft,
    } satisfies QuizQuestionMessage);
  }

  /** "X just finished the mission", at most every few seconds per room. */
  private toast(text: string): void {
    const now = this.hooks.now();
    if (now - this.lastToast < TOAST_INTERVAL_MS) return;
    this.lastToast = now;
    this.hooks.broadcast(MSG.toast, { text });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Accounts in the database have UUIDs; development identities do not and are not saved. */
const isUuid = (id: string) => UUID.test(id);

function pickedBy(progress: Progress, spec: EntitySpec): boolean {
  const data = progress[spec.objectiveId]?.data as { picked?: string[] } | undefined;
  return data?.picked?.includes(spec.id) ?? false;
}
