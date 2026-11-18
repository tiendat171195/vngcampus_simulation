import type { ActiveMission } from '@campus/core';
import { campusIndex } from '@campus/map-data/campus';
import {
  type MissionEntitiesMessage,
  type MissionStateMessage,
  MSG,
  missionDefinitionSchema,
  type QuizQuestionMessage,
  type QuizResultMessage,
} from '@campus/shared';
import { exampleMission, exampleQuestions } from '@campus/shared/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';
import { RoomMissionBinding } from './binding';
import { MissionRuntime } from './runtime';
import { memorySource } from './source';

const ME = '0190f0c2-0000-7000-8000-00000000000a';
const now = Date.now();
const mission: ActiveMission = {
  id: '0190f0c2-0000-7000-8000-0000000000m1'.replace('m1', 'f1'),
  kind: 'daily',
  startsAt: new Date(now - 3_600_000),
  endsAt: new Date(now + 3_600_000),
  definition: missionDefinitionSchema.parse({
    ...exampleMission,
    startsAt: new Date(now - 3_600_000).toISOString(),
    endsAt: new Date(now + 3_600_000).toISOString(),
  }),
};

interface Sent {
  to: string;
  type: string;
  payload: unknown;
}

let source: ReturnType<typeof memorySource>;
let binding: RoomMissionBinding;
let sent: Sent[];
let clock: number;
const positions = new Map<string, { x: number; y: number; z: number }>();
const roster = new Map<string, string>();

beforeEach(async () => {
  source = memorySource([mission], exampleQuestions);
  const runtime = new MissionRuntime(source);
  await runtime.refresh();
  sent = [];
  clock = 0;
  positions.clear();
  roster.clear();
  binding = new RoomMissionBinding(runtime, {
    send: (to, type, payload) => sent.push({ to, type, payload }),
    broadcast: (type, payload) => sent.push({ to: '*', type, payload }),
    position: (sessionId) => positions.get(sessionId) ?? null,
    players: () => [...roster].map(([sessionId, userId]) => ({ sessionId, userId })),
    now: () => clock,
  });
});

const last = <T>(type: string, to = 's1') =>
  sent.filter((message) => message.type === type && message.to === to).at(-1)?.payload as T;
const objective = (id: string, to = 's1') =>
  last<MissionStateMessage>(MSG.missionState, to)?.missions[0]?.objectives.find((o) => o.id === id);
const progressOf = (id: string) =>
  sent
    .filter((message) => message.type === MSG.missionProgress && message.to === 's1')
    .map((message) => (message.payload as { objective: { id: string; current: number } }).objective)
    .filter((o) => o.id === id)
    .at(-1)?.current ?? 0;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function enter(sessionId: string, userId: string, at = { x: 0, y: 0, z: -30 }) {
  positions.set(sessionId, at);
  roster.set(sessionId, userId);
  await binding.join(sessionId, userId, `Người ${sessionId}`);
}

function moveTo(sessionId: string, at: { x: number; y: number; z: number }) {
  positions.set(sessionId, at);
  binding.move(sessionId);
}

describe('room missions', () => {
  it('sends the running mission and the things to find when someone arrives', async () => {
    await enter('s1', ME);
    const state = last<MissionStateMessage>(MSG.missionState);
    expect(state.missions).toHaveLength(1);
    expect(state.missions[0]?.objectives.map((o) => [o.id, o.current, o.target])).toEqual([
      ['o1', 0, 1],
      ['o2', 0, 5],
      ['o3', 0, 4],
      ['o4', 0, 2],
    ]);
    const { entities } = last<MissionEntitiesMessage>(MSG.missionEntities);
    expect(entities.filter((e) => e.kind === 'item')).toHaveLength(4);
    expect(entities.filter((e) => e.kind === 'kiosk').map((e) => e.id)).toEqual([
      'o4:poi.kiosk.lobby',
    ]);
  });

  it('counts arriving at the gate, saved before it is shown', async () => {
    await enter('s1', ME);
    moveTo('s1', { x: 21, y: 0, z: 39 });
    await settle();
    expect(progressOf('o1')).toBe(1);
    expect(source.progress.get(`${mission.id}/${ME}`)?.progress.o1?.done).toBe(true);
  });

  it('counts a player already standing at the place when the mission starts', async () => {
    source.missions = [];
    const runtime = new MissionRuntime(source);
    await runtime.refresh();
    const late = new RoomMissionBinding(runtime, {
      send: (to, type, payload) => sent.push({ to, type, payload }),
      broadcast: () => {},
      position: (sessionId) => positions.get(sessionId) ?? null,
      players: () => [],
      now: () => clock,
    });
    positions.set('s1', { x: 21, y: 0, z: 39 });
    await late.join('s1', ME, 'Đứng Sẵn');
    expect(progressOf('o1')).toBe(0);
    source.missions = [mission];
    await runtime.refresh();
    await settle();
    expect(progressOf('o1')).toBe(1);
  });

  it('shows nothing and keeps nothing when the save fails; the next try works', async () => {
    await enter('s1', ME);
    source.fail = true;
    moveTo('s1', { x: 21, y: 0, z: 39 });
    await settle();
    expect(progressOf('o1')).toBe(0);
    source.fail = false;
    moveTo('s1', { x: 0, y: 0, z: -30 });
    moveTo('s1', { x: 21, y: 0, z: 39 });
    await settle();
    expect(progressOf('o1')).toBe(1);
  });

  it('counts colleagues within the radius of a wave', async () => {
    await enter('s1', ME);
    await enter('s2', 'u2', { x: 2, y: 0, z: -30 });
    await enter('s3', 'u3', { x: 0, y: 0, z: -27 });
    await enter('s4', 'u4', { x: 9, y: 0, z: -30 });
    binding.emote('s1', 'wave');
    await settle();
    expect(progressOf('o2')).toBe(2);
  });

  it('picks up own items only from close by, and they disappear', async () => {
    await enter('s1', ME);
    const items = last<MissionEntitiesMessage>(MSG.missionEntities).entities.filter(
      (e) => e.kind === 'item',
    );
    const item = items[0];
    if (!item) throw new Error('no item');
    expect(await binding.interact('s1', item.id)).toBe('Lại gần hơn một chút.');
    moveTo('s1', { x: item.x + 1, y: item.y, z: item.z });
    clock += 1000;
    expect(await binding.interact('s1', item.id)).toBeNull();
    expect(progressOf('o3')).toBe(1);
    const after = last<MissionEntitiesMessage>(MSG.missionEntities).entities;
    expect(after.some((e) => e.id === item.id)).toBe(false);
    clock += 1000;
    expect(await binding.interact('s1', item.id)).toBe('Vật này không còn ở đây.');
  });

  it('asks quiz questions at the kiosk and judges answers from the bank', async () => {
    await enter('s1', ME);
    const kiosk = campusIndex.pois.get('poi.kiosk.lobby');
    if (!kiosk) throw new Error('no kiosk');
    moveTo('s1', { x: kiosk.position[0] + 1, y: 0, z: kiosk.position[1] });
    expect(await binding.interact('s1', 'o4:poi.kiosk.lobby')).toBeNull();
    const first = last<QuizQuestionMessage>(MSG.quizQuestion);
    expect(first).toMatchObject({ objectiveId: 'o4', index: 1, total: 3, triesLeft: 2 });
    expect(JSON.stringify(first)).not.toContain('correct');

    const right = exampleQuestions.find((q) => q.id === first.questionId)?.correctIndex ?? 0;
    await binding.answer('s1', {
      missionId: mission.id,
      objectiveId: 'o4',
      questionId: first.questionId,
      choice: right,
    });
    expect(last<QuizResultMessage>(MSG.quizResult)).toMatchObject({
      correct: true,
      finished: false,
    });
    expect(progressOf('o4')).toBe(1);
    const second = last<QuizQuestionMessage>(MSG.quizQuestion);
    expect(second.index).toBe(2);
    // An answer to a question not being asked is ignored.
    await binding.answer('s1', {
      missionId: mission.id,
      objectiveId: 'o4',
      questionId: first.questionId,
      choice: right,
    });
    expect(progressOf('o4')).toBe(1);
  });

  it('completes the mission once, tells the room, and remembers it on return', async () => {
    await enter('s1', ME);
    for (const other of ['u2', 'u3', 'u4', 'u5', 'u6'])
      await enter(`x-${other}`, other, { x: 1, y: 0, z: -30 });
    binding.emote('s1', 'wave');
    moveTo('s1', { x: 21, y: 0, z: 39 });
    for (const item of last<MissionEntitiesMessage>(MSG.missionEntities).entities.filter(
      (e) => e.kind === 'item',
    )) {
      moveTo('s1', { x: item.x, y: item.y, z: item.z });
      clock += 1000;
      await binding.interact('s1', item.id);
    }
    const kiosk = campusIndex.pois.get('poi.kiosk.lobby');
    moveTo('s1', { x: (kiosk?.position[0] ?? 0) + 1, y: 0, z: kiosk?.position[1] ?? 0 });
    clock += 1000;
    await binding.interact('s1', 'o4:poi.kiosk.lobby');
    for (let i = 0; i < 2; i++) {
      const question = last<QuizQuestionMessage>(MSG.quizQuestion);
      const choice = exampleQuestions.find((q) => q.id === question.questionId)?.correctIndex ?? 0;
      await binding.answer('s1', {
        missionId: mission.id,
        objectiveId: 'o4',
        questionId: question.questionId,
        choice,
      });
    }
    await settle();
    expect(sent.filter((m) => m.type === MSG.missionCompleted)).toHaveLength(1);
    expect(sent.find((m) => m.type === MSG.toast)?.payload).toEqual({
      text: 'Người s1 vừa hoàn thành nhiệm vụ "Chào tuần mới"!',
    });
    expect(last<MissionEntitiesMessage>(MSG.missionEntities).entities).toEqual([]);

    // Back later, in another room: the progress is still there.
    binding.leave('s1');
    sent = [];
    await enter('s9', ME);
    expect(last<MissionStateMessage>(MSG.missionState, 's9').missions[0]?.completed).toBe(true);
    expect(objective('o3', 's9')?.current).toBe(4);
  });
});

describe('previews', () => {
  it('let an editor play a mission that is not running, alone, without saving or telling the room', async () => {
    const draft: ActiveMission = {
      ...mission,
      id: '0190f0c2-0000-7000-8000-0000000000d1',
      startsAt: new Date(now + 86_400_000),
      endsAt: new Date(now + 2 * 86_400_000),
    };
    source.missions = [draft];
    const runtime = new MissionRuntime(source);
    await runtime.refresh();
    const room = new RoomMissionBinding(runtime, {
      send: (to, type, payload) => sent.push({ to, type, payload }),
      broadcast: (type, payload) => sent.push({ to: '*', type, payload }),
      position: (sessionId) => positions.get(sessionId) ?? null,
      players: () => [],
      now: () => clock,
    });
    positions.set('s1', { x: 21, y: 0, z: 39 });
    positions.set('s2', { x: 21, y: 0, z: 39 });
    await room.join('s1', ME, 'Biên Tập', draft.id);
    await room.join('s2', 'u2', 'Người Khác');
    await settle();

    const state = last<MissionStateMessage>(MSG.missionState);
    expect(state.missions.map((m) => [m.id, m.preview])).toEqual([[draft.id, true]]);
    expect(last<MissionStateMessage>(MSG.missionState, 's2').missions).toEqual([]);
    // Standing at the gate counts, but nothing is written down.
    expect(progressOf('o1')).toBe(1);
    expect(source.progress.size).toBe(0);
    expect(sent.some((m) => m.type === MSG.toast)).toBe(false);
  });
});
