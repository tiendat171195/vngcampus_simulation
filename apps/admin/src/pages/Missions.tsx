import type { AdminMissionSummary } from '@campus/shared';
import { useState } from 'react';
import { api } from '../api';
import { useLoad, when } from '../hooks';
import { addDays, fromVn, isWeekend, monthGrid, today, vnDate } from '../time';

export const STATE_LABEL: Record<string, string> = {
  draft: 'Nháp',
  scheduled: 'Đã lên lịch',
  running: 'Đang chạy',
  ended: 'Đã kết thúc',
  archived: 'Đã huỷ',
};
export const KIND_LABEL: Record<string, string> = {
  daily: 'Nhiệm vụ ngày',
  weekly: 'Nhiệm vụ tuần',
  event: 'Sự kiện',
  onboarding: 'Làm quen',
};

/** Month calendar of missions (docs/08 §3): empty future weekdays in red, then the list. */
export function MissionsPage({ go }: { go: (path: string) => void }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const days = monthGrid(month);
  const first = days[0] as string;
  const last = days[days.length - 1] as string;
  const { data, error } = useLoad(
    () =>
      api<AdminMissionSummary[]>(
        'GET',
        `/admin/missions?from=${encodeURIComponent(fromVn(first, '00:00'))}&to=${encodeURIComponent(fromVn(last, '23:59'))}`,
      ),
    [month],
  );
  const missions = (data ?? []).filter((mission) => mission.state !== 'archived');
  const dailyOn = (day: string) =>
    missions.filter((mission) => mission.kind === 'daily' && vnDate(mission.startsAt) === day);
  const shiftMonth = (by: number) => {
    const [year, m] = month.split('-').map(Number) as [number, number];
    const next = new Date(Date.UTC(year, m - 1 + by, 1));
    setMonth(next.toISOString().slice(0, 7));
  };
  const now = today();

  return (
    <section>
      <div className="row">
        <h1>Nhiệm vụ</h1>
        <button
          type="button"
          className="primary"
          onClick={() => go(`/missions/new?date=${addDays(now, 1)}`)}
        >
          + Tạo nhiệm vụ
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" onClick={() => shiftMonth(-1)}>
          ←
        </button>
        <strong>
          Tháng {month.slice(5)}/{month.slice(0, 4)}
        </strong>
        <button type="button" onClick={() => shiftMonth(1)}>
          →
        </button>
      </div>
      <div className="calendar" data-testid="calendar">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((name) => (
          <b key={name} className="calendar-head">
            {name}
          </b>
        ))}
        {days.map((day) => {
          const daily = dailyOn(day);
          const empty = daily.length === 0 && day > now && !isWeekend(day);
          return (
            <div
              key={day}
              className="calendar-day"
              data-outside={day.slice(0, 7) !== month}
              data-empty={empty}
              data-today={day === now}
            >
              <span className="calendar-date">{Number(day.slice(8))}</span>
              {daily.map((mission) => (
                <button
                  key={mission.id}
                  type="button"
                  className="calendar-mission"
                  data-state={mission.state}
                  onClick={() => go(`/missions/${mission.id}`)}
                >
                  {mission.title.vi}
                  {mission.autoFilled && <small> · tự điền</small>}
                </button>
              ))}
              {empty && (
                <button
                  type="button"
                  className="calendar-add"
                  onClick={() => go(`/missions/new?date=${day}`)}
                >
                  Trống — tạo
                </button>
              )}
            </div>
          );
        })}
      </div>
      <h2>Tất cả nhiệm vụ trong tháng</h2>
      <table data-testid="missions">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Loại</th>
            <th>Trạng thái</th>
            <th>Bắt đầu</th>
            <th>Kết thúc</th>
          </tr>
        </thead>
        <tbody>
          {missions.map((mission) => (
            <tr
              key={mission.id}
              className="clickable"
              onClick={() => go(`/missions/${mission.id}`)}
            >
              <td>{mission.title.vi}</td>
              <td>{KIND_LABEL[mission.kind]}</td>
              <td data-state={mission.state}>{STATE_LABEL[mission.state]}</td>
              <td>{when(mission.startsAt)}</td>
              <td>{when(mission.endsAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
