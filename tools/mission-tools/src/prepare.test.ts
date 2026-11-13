import { readFileSync } from 'node:fs';
import { campusIndex } from '@campus/map-data/campus';
import { describe, expect, it } from 'vitest';
import { prepareMissions, prepareQuestions } from './prepare';

const example = JSON.parse(
  readFileSync(new URL('../examples/chao-tuan-moi.json', import.meta.url), 'utf8'),
);
const questions = JSON.parse(
  readFileSync(new URL('../examples/cau-hoi-van-hoa.json', import.meta.url), 'utf8'),
);

describe('loading missions', () => {
  it('accepts the example file as a daily mission for Monday 16 November', () => {
    const [mission] = prepareMissions(example, campusIndex);
    expect(mission).toMatchObject({ dailyDate: '2026-11-16', warnings: [] });
  });

  it('moves a daily mission to another day for trying it out', () => {
    const [mission] = prepareMissions(example, campusIndex, { today: '2026-12-24' });
    expect(mission?.dailyDate).toBe('2026-12-24');
    expect(mission?.definition.startsAt).toBe('2026-12-23T17:00:00.000Z');
  });

  it('lists every problem: schema, map, and daily missions spanning two days', () => {
    const broken = [
      { ...example, objectives: [] },
      {
        ...example,
        objectives: [{ ...example.objectives[0], params: { targets: [{ areaId: 'area.moon' }] } }],
      },
      { ...example, endsAt: '2026-11-17T05:00:00Z' },
    ];
    expect(() => prepareMissions(broken, campusIndex)).toThrow(
      /Nhiệm vụ 1:[\s\S]*Nhiệm vụ 2 \(Chào tuần mới\):\nMục tiêu o1: không có khu vực "area.moon"[\s\S]*Nhiệm vụ 3[\s\S]*một ngày/,
    );
  });

  it('warns when the mission was written for another map version', () => {
    const [mission] = prepareMissions({ ...example, mapVersion: '9.9.9' }, campusIndex);
    expect(mission?.warnings[0]).toContain('9.9.9');
  });
});

describe('loading questions', () => {
  it('accepts the example bank and refuses duplicate ids', () => {
    expect(prepareQuestions(questions)).toHaveLength(4);
    expect(() => prepareQuestions([questions[0], questions[0]])).toThrow(/bị trùng/);
  });
});
