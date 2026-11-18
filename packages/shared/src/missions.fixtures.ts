// Sample data for tests and tools; not part of the package's main entry.
import type { MissionDefinitionInput, QuizQuestion } from './missions';

/** The example from docs/06-missions.md §11. */
export const exampleMission: MissionDefinitionInput = {
  kind: 'daily',
  title: { vi: 'Chào tuần mới' },
  description: { vi: 'Điểm danh, chào đồng nghiệp và nạp cà phê cho ngày thứ Hai.' },
  startsAt: '2026-11-15T17:00:00Z',
  endsAt: '2026-11-16T16:59:59Z',
  mapVersion: '0.3.0',
  objectiveMode: 'all',
  objectives: [
    {
      id: 'o1',
      type: 'visit',
      title: { vi: 'Điểm danh ở cổng chính' },
      target: 1,
      params: { targets: [{ areaId: 'area.gate_main' }], mode: 'all' },
    },
    {
      id: 'o2',
      type: 'social',
      title: { vi: 'Vẫy tay chào 5 đồng nghiệp' },
      target: 5,
      params: { emote: 'wave', radius: 4 },
    },
    {
      id: 'o3',
      type: 'collect',
      title: { vi: 'Tìm 4 ly cà phê quanh campus' },
      target: 4,
      params: { item: 'coffee_cup', source: { spawnSet: 'outdoor_common' }, scope: 'perPlayer' },
    },
    {
      id: 'o4',
      type: 'quiz',
      title: { vi: 'Trả lời đúng 2 câu ở quầy lễ tân' },
      target: 2,
      params: {
        at: { poiId: 'poi.kiosk.lobby' },
        from: { tags: ['van-hoa'], pick: 3 },
        maxAttempts: 2,
      },
    },
  ],
  rewards: [
    { type: 'points', amount: 100 },
    { type: 'xp', amount: 50 },
  ],
  bonusWindows: [{ from: '12:00', to: '13:30', multiplier: 1.5 }],
  communityGoal: {
    metric: 'completions',
    target: 300,
    rewards: [{ type: 'badge', badgeId: 'team_spirit_2026w47' }],
  },
};

/** Questions the example's quiz objective can draw from (tag `van-hoa`). */
export const exampleQuestions: QuizQuestion[] = [
  {
    id: 'vh-1',
    text: { vi: 'Màu cam trên thẻ nhân viên trong game là màu gì của VNG?' },
    choices: [{ vi: 'Màu nhận diện' }, { vi: 'Màu cảnh báo' }, { vi: 'Màu ngẫu nhiên' }],
    correctIndex: 0,
    tags: ['van-hoa'],
  },
  {
    id: 'vh-2',
    text: { vi: 'Campus nằm bên dòng sông nào?' },
    choices: [{ vi: 'Sông Hồng' }, { vi: 'Sông Sài Gòn' }, { vi: 'Sông Hậu' }],
    correctIndex: 1,
    tags: ['van-hoa'],
  },
  {
    id: 'vh-3',
    text: { vi: 'Hồ cá trong campus nuôi loại cá nào?' },
    choices: [{ vi: 'Cá vàng' }, { vi: 'Cá Koi' }, { vi: 'Cá rô' }],
    correctIndex: 1,
    tags: ['van-hoa'],
  },
  {
    id: 'vh-4',
    text: { vi: 'Nhiệm vụ ngày được làm mới lúc mấy giờ (giờ Việt Nam)?' },
    choices: [{ vi: '00:00' }, { vi: '08:00' }, { vi: '12:00' }],
    correctIndex: 0,
    tags: ['van-hoa'],
  },
];
