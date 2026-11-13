import type {
  MissionCompletedMessage,
  MissionEntity,
  MissionView,
  ObjectiveView,
  QuizQuestionMessage,
  QuizResultMessage,
} from '@campus/shared';
import { create } from 'zustand';

/** Which objective the waypoint points at. */
export interface Tracked {
  missionId: string;
  objectiveId: string;
}

interface MissionState {
  missions: MissionView[];
  /** The banner shows this mission (on arrival and when a new one starts). */
  banner: string | null;
  tracked: Tracked | null;
  /** The question on screen at a kiosk, and how the last answer went. */
  quiz: QuizQuestionMessage | null;
  quizResult: QuizResultMessage | null;
  completed: MissionCompletedMessage | null;
  setMissions(missions: MissionView[]): void;
  updateObjective(missionId: string, objective: ObjectiveView): void;
  setBanner(missionId: string | null): void;
  track(tracked: Tracked | null): void;
  setQuiz(quiz: QuizQuestionMessage | null): void;
  setQuizResult(result: QuizResultMessage | null): void;
  complete(message: MissionCompletedMessage | null): void;
}

/** The first unfinished objective of the first unfinished mission, to point at by default. */
function firstOpen(missions: MissionView[]): Tracked | null {
  for (const mission of missions) {
    if (mission.completed) continue;
    const objective = mission.objectives.find((o) => !o.done);
    if (objective) return { missionId: mission.id, objectiveId: objective.id };
  }
  return null;
}

/** Mission state shown by the HUD. Changes a few times a minute at most: fine for React. */
export const useMissions = create<MissionState>((set, get) => ({
  missions: [],
  banner: null,
  tracked: null,
  quiz: null,
  quizResult: null,
  completed: null,
  setMissions(missions) {
    const known = new Set(get().missions.map((mission) => mission.id));
    const fresh = missions.find((mission) => !known.has(mission.id) && !mission.completed);
    const tracked = get().tracked;
    const stillOpen =
      tracked &&
      missions
        .find((mission) => mission.id === tracked.missionId)
        ?.objectives.some((o) => o.id === tracked.objectiveId && !o.done);
    set({
      missions,
      banner: fresh ? fresh.id : get().banner,
      tracked: stillOpen ? tracked : firstOpen(missions),
    });
  },
  updateObjective(missionId, objective) {
    const missions = get().missions.map((mission) =>
      mission.id !== missionId
        ? mission
        : {
            ...mission,
            objectives: mission.objectives.map((o) => (o.id === objective.id ? objective : o)),
          },
    );
    const tracked = get().tracked;
    const done =
      tracked?.missionId === missionId && tracked.objectiveId === objective.id && objective.done;
    set({ missions, tracked: done || !tracked ? firstOpen(missions) : tracked });
  },
  setBanner: (banner) => set({ banner }),
  track: (tracked) => set({ tracked }),
  // The next question comes right after the result: keep the result on screen with it.
  setQuiz: (quiz) => set(quiz ? { quiz } : { quiz: null, quizResult: null }),
  setQuizResult: (quizResult) => set({ quizResult }),
  complete(message) {
    if (!message) return set({ completed: null });
    const missions = get().missions.map((mission) =>
      mission.id === message.missionId ? { ...mission, completed: true } : mission,
    );
    set({ completed: message, missions, tracked: firstOpen(missions) });
  },
}));

/**
 * Mission things in the world, read every frame by the scene and the interaction check. Replaced
 * as a whole when the server sends a new list; `version` tells the scene to rebuild.
 */
export const missionWorld: { entities: MissionEntity[]; version: number } = {
  entities: [],
  version: 0,
};

export function setMissionEntities(entities: MissionEntity[]): void {
  missionWorld.entities = entities;
  missionWorld.version++;
}
