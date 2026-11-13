import { describe, expect, it } from 'vitest';
import { missionDefinitionSchema, quizQuestionSchema } from './missions';
import { exampleMission } from './missions.fixtures';

const issues = (input: unknown) => {
  const parsed = missionDefinitionSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
};

describe('mission definitions', () => {
  it('accept the documented example and fill in defaults', () => {
    const mission = missionDefinitionSchema.parse(exampleMission);
    const social = mission.objectives[1];
    expect(social?.type === 'social' && social.params).toEqual({
      emote: 'wave',
      radius: 4,
      mutual: false,
    });
    expect(mission.objectives.every((objective) => objective.optional === false)).toBe(true);
  });

  it('refuse missions that cannot be played as written', () => {
    const objectives = exampleMission.objectives;
    expect(issues({ ...exampleMission, endsAt: exampleMission.startsAt })).toEqual(['endsAt']);
    expect(issues({ ...exampleMission, objectives: [objectives[0], objectives[0]] })).toEqual([
      'objectives.1.id',
    ]);
    expect(issues({ ...exampleMission, objectives: [{ ...objectives[0], target: 2 }] })).toEqual([
      'objectives.0.target',
    ]);
    expect(issues({ ...exampleMission, objectives: [{ ...objectives[3], target: 4 }] })).toEqual([
      'objectives.0.target',
    ]);
    expect(issues({ ...exampleMission, objectiveMode: { anyOf: 5 } })).toEqual([
      'objectiveMode.anyOf',
    ]);
    expect(
      issues({ ...exampleMission, bonusWindows: [{ from: '14:00', to: '13:00', multiplier: 2 }] }),
    ).toEqual(['bonusWindows.0']);
  });

  it('check every objective against its own parameters', () => {
    const [visit, social, collect] = exampleMission.objectives;
    expect(
      issues({ ...exampleMission, objectives: [{ ...social, params: { emote: 'moonwalk' } }] }),
    ).toEqual(['objectives.0.params.emote']);
    expect(
      issues({
        ...exampleMission,
        objectives: [{ ...visit, params: { targets: [{ areaId: 'gate' }] } }],
      }),
    ).toEqual(['objectives.0.params.targets.0.areaId']);
    expect(
      issues({ ...exampleMission, objectives: [{ ...collect, type: 'visit' }] }).length,
    ).toBeGreaterThan(0);
    expect(issues({ ...exampleMission, objectives: [{ ...visit, type: 'teleport' }] })).toEqual([
      'objectives.0.type',
    ]);
  });
});

describe('quiz questions', () => {
  it('need the right answer among the choices', () => {
    const question = {
      id: 'q1',
      text: { vi: 'VNG thành lập năm nào?' },
      choices: [{ vi: '2004' }, { vi: '2008' }],
      correctIndex: 0,
    };
    expect(quizQuestionSchema.parse(question).tags).toEqual([]);
    expect(quizQuestionSchema.safeParse({ ...question, correctIndex: 2 }).success).toBe(false);
  });
});
