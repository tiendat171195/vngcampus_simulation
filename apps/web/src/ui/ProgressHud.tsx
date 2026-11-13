import type { LeaderboardDto, MissionHistoryItem, StatsDto } from '@campus/shared';
import { useEffect, useState } from 'react';
import { useMissions } from '../game/missions/missionStore';
import { currentUser } from '../services/auth';
import { loadHistory, loadLeaderboard, loadStats } from '../services/directory';

/** Level, points and streak; refreshed after each completed mission. */
export function StatsChip() {
  const completed = useMissions((state) => state.completed);
  const [stats, setStats] = useState<StatsDto | null>(null);
  useEffect(() => {
    // `completed` changes when a mission is done: fetch again then.
    void completed;
    let live = true;
    void loadStats().then((result) => {
      if (live && typeof result !== 'string') setStats(result);
    });
    return () => {
      live = false;
    };
  }, [completed]);
  if (!stats) return null;
  const progress = (stats.xp - stats.levelFrom) / Math.max(1, stats.levelTo - stats.levelFrom);
  return (
    <div className="stats-chip" data-testid="stats-chip" title={`${stats.xp} kinh nghiệm`}>
      <span className="stats-level">
        Cấp {stats.level}
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
      <span>{stats.points} điểm</span>
      {stats.streakCurrent > 0 && <span>🔥 {stats.streakCurrent}</span>}
    </div>
  );
}

type Tab = 'week' | 'month' | 'all' | 'departments' | 'mission';
const TABS: Array<{ tab: Tab; label: string }> = [
  { tab: 'mission', label: 'Hôm nay' },
  { tab: 'week', label: 'Tuần' },
  { tab: 'month', label: 'Tháng' },
  { tab: 'all', label: 'Mọi lúc' },
  { tab: 'departments', label: 'Phòng ban' },
];

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} phút`;

/** Leaderboards (docs/06 §7): today's mission by time, points by period, departments. */
export function LeaderboardPanel({ hidden }: { hidden: boolean }) {
  const mission = useMissions(
    (state) => state.missions.find((m) => m.kind === 'daily') ?? state.missions[0],
  );
  const [tab, setTab] = useState<Tab>('week');
  const [board, setBoard] = useState<LeaderboardDto | string | null>(null);
  const me = currentUser()?.id;

  useEffect(() => {
    if (hidden) return;
    let live = true;
    setBoard(null);
    const request =
      tab === 'mission'
        ? mission
          ? loadLeaderboard({ kind: 'mission', missionId: mission.id })
          : Promise.resolve('Hôm nay chưa có nhiệm vụ.')
        : tab === 'departments'
          ? loadLeaderboard({ kind: 'departments' })
          : loadLeaderboard({ kind: 'points', period: tab });
    void request.then((result) => {
      if (live) setBoard(result);
    });
    return () => {
      live = false;
    };
  }, [hidden, tab, mission]);

  const score = (value: number) =>
    tab === 'mission'
      ? minutes(value)
      : tab === 'departments'
        ? `${value} điểm/người`
        : `${value} điểm`;
  const rows = board && typeof board !== 'string' ? board.rows : [];
  return (
    <section className="panel leaderboard" aria-label="Bảng xếp hạng" hidden={hidden}>
      <div className="buttons">
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            aria-pressed={tab === item.tab}
            onClick={() => setTab(item.tab)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {board === null && <p className="note">Đang tải…</p>}
      {typeof board === 'string' && <p className="note">{board}</p>}
      {board && typeof board !== 'string' && rows.length === 0 && (
        <p className="note">Chưa có ai.</p>
      )}
      <ol className="leaderboard-list" data-testid="leaderboard">
        {rows.map((row) => (
          <li key={row.id} data-me={row.id === me}>
            <b>{row.rank}</b>
            <span>{row.name}</span>
            <span className="leaderboard-score">{score(row.score)}</span>
          </li>
        ))}
        {board && typeof board !== 'string' && board.me && (
          <li data-me="true" className="leaderboard-me">
            <b>{board.me.rank}</b>
            <span>{board.me.name}</span>
            <span className="leaderboard-score">{score(board.me.score)}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

/** Missions this person took part in, for the profile panel. */
export function MissionHistory({ hidden }: { hidden: boolean }) {
  const [items, setItems] = useState<MissionHistoryItem[] | null>(null);
  useEffect(() => {
    if (hidden) return;
    let live = true;
    void loadHistory().then((result) => {
      if (live) setItems(typeof result === 'string' ? [] : result);
    });
    return () => {
      live = false;
    };
  }, [hidden]);
  if (!items || items.length === 0) return null;
  return (
    <div className="group">
      <span className="group-label">Nhiệm vụ đã làm</span>
      <ul className="history-list" data-testid="mission-history">
        {items.slice(0, 10).map((item) => (
          <li key={item.missionId}>
            <span>{item.title.vi}</span>
            <span className="note">
              {item.completedAt
                ? `✓ ${minutes(item.durationMs ?? 0)}${item.rank ? ` · hạng ${item.rank}` : ''}`
                : 'chưa xong'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
