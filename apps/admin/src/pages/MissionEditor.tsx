import { campusIndex, campusMap } from '@campus/map-data/campus';
import {
  type AdminMissionDto,
  type AdminMissionSummary,
  EMOTES,
  type MissionDefinitionInput,
  type PublishCheckDto,
  type TemplateDetailDto,
  type TemplateDto,
} from '@campus/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiFailure, api, gameUrl } from '../api';
import { MapPicker } from '../components/MapPicker';
import { useLoad } from '../hooks';
import { fromVn, today, vnClock, vnDate } from '../time';
import { KIND_LABEL, STATE_LABEL } from './Missions';

type ObjectiveType = 'visit' | 'collect' | 'quiz' | 'social';

interface ObjectiveDraft {
  id: string;
  type: ObjectiveType;
  title: string;
  hint: string;
  target: number;
  optional: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: parameters differ by type and are checked by the server.
  params: any;
}

interface Draft {
  kind: string;
  title: string;
  description: string;
  /** Daily missions: a Vietnam day and a window inside it. */
  date: string;
  from: string;
  to: string;
  /** Other kinds: start and end, Vietnam time, `YYYY-MM-DDTHH:mm`. */
  start: string;
  end: string;
  mode: 'all' | 'sequential' | 'anyOf';
  anyOf: number;
  objectives: ObjectiveDraft[];
  points: number;
  xp: number;
  bonusWindows: Array<{ from: string; to: string; multiplier: number }>;
  communityTarget: number;
  communityPoints: number;
  /** Fields this form does not edit, kept as they were. */
  extra: Record<string, unknown>;
}

const TYPE_LABEL: Record<ObjectiveType, string> = {
  visit: 'Ghé điểm',
  collect: 'Thu thập',
  quiz: 'Trả lời câu hỏi',
  social: 'Chào hỏi',
};
const ITEMS: Record<string, string> = {
  coffee_cup: 'Ly cà phê',
  tea_cup: 'Ly trà',
  book: 'Cuốn sách',
  flower: 'Bông hoa',
  gift: 'Hộp quà',
  lantern: 'Đèn lồng',
};
const KIOSKS = [...campusIndex.pois.values()].filter(
  (poi) => poi.kind === 'kiosk_spot' || poi.kind === 'npc_spot',
);
const placeName = (id: string) =>
  campusIndex.areas.get(id)?.name.vi ?? campusIndex.pois.get(id)?.name?.vi ?? id;

function newObjective(type: ObjectiveType, taken: string[]): ObjectiveDraft {
  let n = 1;
  while (taken.includes(`o${n}`)) n++;
  const base = { id: `o${n}`, type, hint: '', optional: false };
  switch (type) {
    case 'visit':
      return {
        ...base,
        title: 'Ghé cổng chính',
        target: 1,
        params: { targets: [{ areaId: 'area.gate_main' }], mode: 'all' },
      };
    case 'collect':
      return {
        ...base,
        title: 'Tìm 4 ly cà phê',
        target: 4,
        params: { item: 'coffee_cup', source: { spawnSet: 'outdoor_common' }, scope: 'perPlayer' },
      };
    case 'quiz':
      return {
        ...base,
        title: 'Trả lời đúng 2 câu',
        target: 2,
        params: {
          at: { poiId: KIOSKS[0]?.id ?? 'poi.kiosk.lobby' },
          from: { tags: ['van-hoa'], pick: 3 },
          maxAttempts: 2,
        },
      };
    case 'social':
      return {
        ...base,
        title: 'Vẫy tay chào 3 đồng nghiệp',
        target: 3,
        params: { emote: 'wave', radius: 4 },
      };
  }
}

function blankDraft(date: string): Draft {
  return {
    kind: 'daily',
    title: '',
    description: '',
    date,
    from: '00:00',
    to: '23:59',
    start: `${date}T09:00`,
    end: `${date}T18:00`,
    mode: 'all',
    anyOf: 1,
    objectives: [newObjective('visit', [])],
    points: 100,
    xp: 50,
    bonusWindows: [],
    communityTarget: 0,
    communityPoints: 0,
    extra: {},
  };
}

// biome-ignore lint/suspicious/noExplicitAny: a stored definition, read loosely into the form.
function fromDefinition(definition: any): Draft {
  const {
    kind,
    title,
    description,
    startsAt,
    endsAt,
    objectiveMode,
    objectives,
    rewards,
    bonusWindows,
    communityGoal,
    mapVersion: _map,
    ...extra
  } = definition;
  const reward = (type: string) =>
    rewards?.find((r: { type: string }) => r.type === type)?.amount ?? 0;
  return {
    kind,
    title: title?.vi ?? '',
    description: description?.vi ?? '',
    date: vnDate(startsAt),
    from: vnClock(startsAt),
    to: vnClock(endsAt),
    start: `${vnDate(startsAt)}T${vnClock(startsAt)}`,
    end: `${vnDate(endsAt)}T${vnClock(endsAt)}`,
    mode: typeof objectiveMode === 'object' ? 'anyOf' : (objectiveMode ?? 'all'),
    anyOf: typeof objectiveMode === 'object' ? objectiveMode.anyOf : 1,
    objectives: (objectives ?? []).map(
      (o: ObjectiveDraft & { title: { vi: string }; hint?: { vi: string } }) => ({
        ...o,
        title: o.title?.vi ?? '',
        hint: o.hint?.vi ?? '',
        optional: Boolean(o.optional),
      }),
    ),
    points: reward('points'),
    xp: reward('xp'),
    bonusWindows: bonusWindows ?? [],
    communityTarget: communityGoal?.target ?? 0,
    communityPoints:
      communityGoal?.rewards?.find((r: { type: string }) => r.type === 'points')?.amount ?? 0,
    extra,
  };
}

function toDefinition(draft: Draft): MissionDefinitionInput {
  const daily = draft.kind === 'daily';
  const rewards = [
    ...(draft.points > 0 ? [{ type: 'points' as const, amount: draft.points }] : []),
    ...(draft.xp > 0 ? [{ type: 'xp' as const, amount: draft.xp }] : []),
  ];
  return {
    ...draft.extra,
    kind: draft.kind as MissionDefinitionInput['kind'],
    title: { vi: draft.title },
    description: { vi: draft.description },
    startsAt: daily
      ? fromVn(draft.date, draft.from)
      : fromVn(draft.start.slice(0, 10), draft.start.slice(11, 16)),
    endsAt: daily
      ? fromVn(draft.date, draft.to, '59')
      : fromVn(draft.end.slice(0, 10), draft.end.slice(11, 16)),
    mapVersion: campusMap.version,
    objectiveMode: draft.mode === 'anyOf' ? { anyOf: draft.anyOf } : draft.mode,
    objectives: draft.objectives.map((o) => ({
      id: o.id,
      type: o.type,
      title: { vi: o.title },
      ...(o.hint ? { hint: { vi: o.hint } } : {}),
      target:
        o.type === 'visit' && o.params.mode !== 'any'
          ? Math.max(1, o.params.targets.length)
          : o.target,
      optional: o.optional,
      params: o.params,
    })) as MissionDefinitionInput['objectives'],
    rewards,
    ...(draft.bonusWindows.length ? { bonusWindows: draft.bonusWindows } : {}),
    ...(draft.communityTarget > 0
      ? {
          communityGoal: {
            metric: 'completions' as const,
            target: draft.communityTarget,
            rewards: [{ type: 'points' as const, amount: Math.max(1, draft.communityPoints) }],
          },
        }
      : {}),
  };
}

/** A template moved to the chosen day, keeping its hours (docs/08 §4 step 1). */
function fromTemplate(definition: unknown, date: string): Draft {
  const draft = fromDefinition(definition);
  const days = Math.round((Date.parse(date) - Date.parse(draft.date)) / 86_400_000);
  const shift = (local: string) => {
    const moved = new Date(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) + days * 86_400_000);
    return `${moved.toISOString().slice(0, 10)}${local.slice(10)}`;
  };
  return { ...draft, date, start: shift(draft.start), end: shift(draft.end) };
}

/** The editor (docs/08 §4): general fields, objectives with a map, rewards, live checks. */
export function MissionEditorPage({ id, go }: { id: string | null; go: (path: string) => void }) {
  const query = new URLSearchParams(window.location.search);
  const initialDate = query.get('date') ?? today();
  const templates = useLoad(
    () => (id ? Promise.resolve([]) : api<TemplateDto[]>('GET', '/admin/templates')),
    [id],
  );
  const loaded = useLoad(
    () => (id ? api<AdminMissionDto>('GET', `/admin/missions/${id}`) : Promise.resolve(null)),
    [id],
  );
  const [draft, setDraft] = useState<Draft | null>(id ? null : blankDraft(initialDate));
  const [mission, setMission] = useState<AdminMissionSummary | null>(null);
  const [check, setCheck] = useState<PublishCheckDto | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded.data) return;
    setMission(loaded.data);
    setDraft(fromDefinition(loaded.data.definition));
  }, [loaded.data]);

  const applyTemplate = (templateId: string) => {
    if (!templateId) {
      setDraft(blankDraft(initialDate));
      return;
    }
    api<TemplateDetailDto>('GET', `/admin/templates/${templateId}`).then(
      (template) => setDraft(fromTemplate(template.definition, initialDate)),
      (failure: Error) => setMessage({ text: failure.message, error: true }),
    );
  };
  // `/missions/new?template=…` from the templates page.
  useEffect(() => {
    const templateId = query.get('template');
    if (!id && templateId) applyTemplate(templateId);
  }, []);

  const definition = useMemo(() => (draft ? toDefinition(draft) : null), [draft]);
  // Checks run on the server as you type (docs/08 §4.3).
  useEffect(() => {
    if (!definition) return;
    const timer = window.setTimeout(() => {
      api<PublishCheckDto>('POST', '/admin/missions/validate', {
        definition,
        ...(id ? { missionId: id } : {}),
      }).then(setCheck, () => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [definition, id]);

  if (loaded.error) return <p className="error">{loaded.error}</p>;
  if (!draft || !definition) return <p className="muted">Đang tải…</p>;
  const state = mission?.state ?? 'draft';
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const updateObjective = (index: number, patch: Partial<ObjectiveDraft>) =>
    update({ objectives: draft.objectives.map((o, i) => (i === index ? { ...o, ...patch } : o)) });
  const updateParams = (index: number, patch: object) =>
    updateObjective(index, { params: { ...draft.objectives[index]?.params, ...patch } });
  const move = (index: number, by: number) => {
    const list = [...draft.objectives];
    const [item] = list.splice(index, 1);
    if (item) list.splice(index + by, 0, item);
    update({ objectives: list });
  };

  const act = async (
    label: string,
    action: () => Promise<AdminMissionSummary | AdminMissionDto>,
  ) => {
    setMessage(null);
    try {
      const result = await action();
      setMission(result);
      setMessage({ text: label, error: false });
      if (!id) go(`/missions/${result.id}`);
      else if (result.id !== id) go(`/missions/${result.id}`);
    } catch (failure) {
      const details = failure instanceof ApiFailure ? failure.message : 'Có lỗi xảy ra.';
      setMessage({ text: details, error: true });
    }
  };
  const saveDraft = () =>
    id
      ? api<AdminMissionDto>('PUT', `/admin/missions/${id}`, { definition })
      : api<AdminMissionDto>('POST', '/admin/missions', { definition });

  return (
    <section className="editor" data-testid="mission-editor">
      <button type="button" className="link" onClick={() => go('/missions')}>
        ← Lịch nhiệm vụ
      </button>
      <div className="row">
        <h1>{id ? draft.title || 'Nhiệm vụ' : 'Nhiệm vụ mới'}</h1>
        <span className="tag" data-state={state}>
          {STATE_LABEL[state]}
        </span>
      </div>
      {state === 'running' && (
        <p className="note">Nhiệm vụ đang chạy: chỉ sửa được chữ và tăng thưởng.</p>
      )}
      {!id && (templates.data?.length ?? 0) > 0 && (
        <label className="from-template">
          Bắt đầu từ mẫu
          <select
            data-testid="template-select"
            defaultValue={query.get('template') ?? ''}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">— Trống —</option>
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id} disabled={template.broken}>
                {template.name}
                {template.broken ? ' (cần sửa)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="panel grid2">
        <label>
          Loại
          <select value={draft.kind} onChange={(e) => update({ kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tên nhiệm vụ
          <input
            value={draft.title}
            maxLength={200}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label className="wide">
          Mô tả
          <textarea
            value={draft.description}
            maxLength={200}
            rows={2}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
        {draft.kind === 'daily' ? (
          <>
            <label>
              Ngày (giờ Việt Nam)
              <input
                type="date"
                value={draft.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            </label>
            <label>
              Khung giờ
              <span className="inline">
                <input
                  type="time"
                  value={draft.from}
                  onChange={(e) => update({ from: e.target.value })}
                />{' '}
                –
                <input
                  type="time"
                  value={draft.to}
                  onChange={(e) => update({ to: e.target.value })}
                />
              </span>
            </label>
          </>
        ) : (
          <>
            <label>
              Bắt đầu (giờ Việt Nam)
              <input
                type="datetime-local"
                value={draft.start}
                onChange={(e) => update({ start: e.target.value })}
              />
            </label>
            <label>
              Kết thúc
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(e) => update({ end: e.target.value })}
              />
            </label>
          </>
        )}
      </div>

      <h2>Mục tiêu</h2>
      <div className="row">
        <select
          value={draft.mode}
          aria-label="Cách hoàn thành"
          onChange={(e) => update({ mode: e.target.value as Draft['mode'] })}
        >
          <option value="all">Làm hết, thứ tự tuỳ ý</option>
          <option value="sequential">Làm lần lượt theo thứ tự</option>
          <option value="anyOf">Làm đủ một số mục tiêu</option>
        </select>
        {draft.mode === 'anyOf' && (
          <input
            type="number"
            min={1}
            value={draft.anyOf}
            aria-label="Số mục tiêu cần"
            onChange={(e) => update({ anyOf: Number(e.target.value) })}
          />
        )}
      </div>
      {draft.objectives.map((objective, index) => (
        <div
          key={objective.id}
          className="panel objective"
          data-testid={`objective-${objective.id}`}
        >
          <div className="row">
            <b>
              {objective.id} · {TYPE_LABEL[objective.type]}
            </b>
            <span className="spacer" />
            <button
              type="button"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              aria-label="Lên"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === draft.objectives.length - 1}
              onClick={() => move(index, 1)}
              aria-label="Xuống"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => update({ objectives: draft.objectives.filter((_, i) => i !== index) })}
            >
              Xoá
            </button>
          </div>
          <div className="grid2">
            <label>
              Tiêu đề hiện cho người chơi
              <input
                value={objective.title}
                onChange={(e) => updateObjective(index, { title: e.target.value })}
              />
            </label>
            <label>
              Gợi ý (không bắt buộc)
              <input
                value={objective.hint}
                onChange={(e) => updateObjective(index, { hint: e.target.value })}
              />
            </label>
            {objective.type !== 'visit' && (
              <label>
                Số lượng cần đạt
                <input
                  type="number"
                  min={1}
                  value={objective.target}
                  onChange={(e) => updateObjective(index, { target: Number(e.target.value) })}
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={objective.optional}
                onChange={(e) => updateObjective(index, { optional: e.target.checked })}
              />{' '}
              Không bắt buộc
            </label>
          </div>

          {objective.type === 'visit' && (
            <>
              <p>
                Địa điểm:{' '}
                {objective.params.targets.map(
                  (target: { areaId?: string; poiId?: string }, t: number) => (
                    <span key={target.areaId ?? target.poiId} className="tag">
                      {placeName(target.areaId ?? target.poiId ?? '')}{' '}
                      <button
                        type="button"
                        className="link"
                        aria-label="Bỏ địa điểm"
                        onClick={() =>
                          updateParams(index, {
                            targets: objective.params.targets.filter(
                              (_: unknown, k: number) => k !== t,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ),
                )}
              </p>
              <div className="row">
                <select
                  value={objective.params.mode}
                  aria-label="Cần ghé"
                  onChange={(e) => updateParams(index, { mode: e.target.value })}
                >
                  <option value="all">Ghé tất cả</option>
                  <option value="any">Ghé một trong số đó</option>
                </select>
                <label className="inline">
                  Đứng lại (giây)
                  <input
                    type="number"
                    min={0}
                    value={objective.params.dwellSec ?? 0}
                    onChange={(e) =>
                      updateParams(index, { dwellSec: Number(e.target.value) || undefined })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPicking(picking === objective.id ? null : objective.id)}
                >
                  {picking === objective.id ? 'Xong' : 'Chọn trên bản đồ'}
                </button>
              </div>
              {picking === objective.id && (
                <MapPicker
                  selected={objective.params.targets.map(
                    (t: { areaId?: string; poiId?: string }) => t.areaId ?? t.poiId,
                  )}
                  onPick={(pick) => {
                    const targets = objective.params.targets as Array<{
                      areaId?: string;
                      poiId?: string;
                    }>;
                    if (targets.some((t) => t.areaId === pick.id || t.poiId === pick.id)) return;
                    updateParams(index, {
                      targets: [
                        ...targets,
                        pick.kind === 'area' ? { areaId: pick.id } : { poiId: pick.id, radius: 3 },
                      ],
                    });
                  }}
                />
              )}
            </>
          )}

          {objective.type === 'collect' && (
            <div className="grid2">
              <label>
                Vật phẩm
                <select
                  value={objective.params.item}
                  onChange={(e) => updateParams(index, { item: e.target.value })}
                >
                  {Object.entries(ITEMS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rải ở
                <select
                  value={objective.params.source.spawnSet}
                  onChange={(e) => updateParams(index, { source: { spawnSet: e.target.value } })}
                >
                  {Object.entries(campusMap.spawnSets).map(([name, spots]) => (
                    <option key={name} value={name}>
                      {name} ({spots.length} chỗ)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ai nhặt
                <select
                  value={objective.params.scope}
                  onChange={(e) => updateParams(index, { scope: e.target.value })}
                >
                  <option value="perPlayer">Mỗi người một bộ riêng</option>
                  <option value="shared">Dùng chung, ai nhanh thì được</option>
                </select>
              </label>
            </div>
          )}

          {objective.type === 'quiz' && (
            <div className="grid2">
              <label>
                Ở kiosk
                <select
                  value={objective.params.at.poiId}
                  onChange={(e) => updateParams(index, { at: { poiId: e.target.value } })}
                >
                  {KIOSKS.map((poi) => (
                    <option key={poi.id} value={poi.id}>
                      {poi.name?.vi ?? poi.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Câu hỏi có tag (cách nhau dấu phẩy)
                <input
                  value={('tags' in objective.params.from ? objective.params.from.tags : []).join(
                    ', ',
                  )}
                  onChange={(e) =>
                    updateParams(index, {
                      from: {
                        tags: e.target.value
                          .split(',')
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                        pick: objective.params.from.pick ?? 3,
                      },
                    })
                  }
                />
              </label>
              <label>
                Số câu mỗi lượt
                <input
                  type="number"
                  min={1}
                  value={objective.params.from.pick ?? 3}
                  onChange={(e) =>
                    updateParams(index, {
                      from: {
                        tags: objective.params.from.tags ?? [],
                        pick: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Số lần thử mỗi câu
                <input
                  type="number"
                  min={1}
                  value={objective.params.maxAttempts ?? 2}
                  onChange={(e) => updateParams(index, { maxAttempts: Number(e.target.value) })}
                />
              </label>
            </div>
          )}

          {objective.type === 'social' && (
            <div className="grid2">
              <label>
                Biểu cảm
                <select
                  value={objective.params.emote}
                  onChange={(e) => updateParams(index, { emote: e.target.value })}
                >
                  {Object.entries(EMOTES).map(([name, emote]) => (
                    <option key={name} value={name}>
                      {emote.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Trong vòng (m)
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={objective.params.radius ?? 4}
                  onChange={(e) => updateParams(index, { radius: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </div>
      ))}
      <div className="row">
        {(Object.keys(TYPE_LABEL) as ObjectiveType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() =>
              update({
                objectives: [
                  ...draft.objectives,
                  newObjective(
                    type,
                    draft.objectives.map((o) => o.id),
                  ),
                ],
              })
            }
          >
            + {TYPE_LABEL[type]}
          </button>
        ))}
      </div>

      <h2>Phần thưởng</h2>
      <div className="panel grid2">
        <label>
          Điểm
          <input
            type="number"
            min={0}
            value={draft.points}
            onChange={(e) => update({ points: Number(e.target.value) })}
          />
        </label>
        <label>
          Kinh nghiệm
          <input
            type="number"
            min={0}
            value={draft.xp}
            onChange={(e) => update({ xp: Number(e.target.value) })}
          />
        </label>
        <div className="field">
          Giờ vàng (×1,5 thưởng)
          <span className="inline">
            {draft.bonusWindows.length === 0 ? (
              <button
                type="button"
                onClick={() =>
                  update({ bonusWindows: [{ from: '12:00', to: '13:30', multiplier: 1.5 }] })
                }
              >
                + Thêm 12:00–13:30
              </button>
            ) : (
              <>
                {draft.bonusWindows[0]?.from}–{draft.bonusWindows[0]?.to}
                <button type="button" onClick={() => update({ bonusWindows: [] })}>
                  Bỏ
                </button>
              </>
            )}
          </span>
        </div>
        <div className="field">
          Mục tiêu chung: số lượt hoàn thành (0 = không có)
          <span className="inline">
            <input
              type="number"
              min={0}
              value={draft.communityTarget}
              onChange={(e) => update({ communityTarget: Number(e.target.value) })}
            />
            {draft.communityTarget > 0 && (
              <>
                thưởng
                <input
                  type="number"
                  min={1}
                  value={draft.communityPoints}
                  aria-label="Điểm thưởng mục tiêu chung"
                  onChange={(e) => update({ communityPoints: Number(e.target.value) })}
                />
                điểm
              </>
            )}
          </span>
        </div>
      </div>

      <div className="panel checks" data-testid="checks">
        <h2>Kiểm tra</h2>
        {!check && <p className="muted">Đang kiểm tra…</p>}
        {check && check.errors.length === 0 && <p className="ok">Sẵn sàng xuất bản.</p>}
        <ul>
          {check?.errors.map((error) => (
            <li key={error} className="error">
              {error}
            </li>
          ))}
          {check?.warnings.map((warning) => (
            <li key={warning} className="warn">
              {warning}
            </li>
          ))}
        </ul>
      </div>

      {message && (
        <p className={message.error ? 'error' : 'ok'} role="status">
          {message.text}
        </p>
      )}
      <div className="row actions">
        {(state === 'draft' || state === 'scheduled' || state === 'running') && (
          <button type="button" onClick={() => void act('Đã lưu.', saveDraft)}>
            {id ? 'Lưu' : 'Lưu nháp'}
          </button>
        )}
        {state === 'draft' && id && (
          <button
            type="button"
            className="primary"
            disabled={Boolean(check?.errors.length)}
            onClick={() =>
              void act('Đã xuất bản.', async () => {
                await saveDraft();
                return api<AdminMissionSummary>('POST', `/admin/missions/${id}/publish`);
              })
            }
          >
            Xuất bản
          </button>
        )}
        {state === 'scheduled' && id && (
          <button
            type="button"
            onClick={() =>
              void act('Đã gỡ, nhiệm vụ về nháp.', () =>
                api('POST', `/admin/missions/${id}/unpublish`),
              )
            }
          >
            Gỡ xuất bản
          </button>
        )}
        {state === 'running' && id && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Kết thúc nhiệm vụ ngay bây giờ?'))
                void act('Đã kết thúc.', () => api('POST', `/admin/missions/${id}/end`));
            }}
          >
            Kết thúc sớm
          </button>
        )}
        {id && (
          <button
            type="button"
            onClick={() =>
              void act('Đã nhân bản sang ngày hôm sau.', () =>
                api('POST', `/admin/missions/${id}/duplicate`, { shiftDays: 1 }),
              )
            }
          >
            Nhân bản
          </button>
        )}
        {id && (
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Tên mẫu', draft.title);
              if (!name) return;
              setMessage(null);
              api('POST', '/admin/templates', { name, missionId: id }).then(
                () => setMessage({ text: `Đã lưu thành mẫu "${name}".`, error: false }),
                (failure: Error) => setMessage({ text: failure.message, error: true }),
              );
            }}
          >
            Lưu làm mẫu
          </button>
        )}
        {id && (state === 'running' || state === 'ended') && (
          <a
            className="button secondary"
            href={`/missions/${id}/results`}
            onClick={(event) => {
              event.preventDefault();
              go(`/missions/${id}/results`);
            }}
          >
            Xem kết quả
          </a>
        )}
        {id && (
          <a
            className="button secondary"
            href={`${gameUrl()}?preview=${id}`}
            target="_blank"
            rel="noreferrer"
          >
            Xem thử trong game
          </a>
        )}
        {state === 'draft' && id && (
          <button
            type="button"
            className="danger"
            onClick={() =>
              void act('Đã huỷ bản nháp.', () => api('DELETE', `/admin/missions/${id}`))
            }
          >
            Huỷ nháp
          </button>
        )}
      </div>
    </section>
  );
}
