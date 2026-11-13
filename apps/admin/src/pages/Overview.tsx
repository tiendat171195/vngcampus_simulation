import {
  type AdminMeDto,
  type ChannelInfo,
  type DashboardDto,
  FPS_BUCKETS,
  LOAD_BUCKETS,
} from '@campus/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { href, useLoad } from '../hooks';
import { duration } from './MissionResults';

const STATE_LABEL: Record<string, string> = {
  scheduled: 'Sắp chạy',
  running: 'Đang chạy',
  ended: 'Đã kết thúc',
};

/** People in the campus right now, by channel; read from the realtime server every 5 s. */
function useOnline() {
  const [channels, setChannels] = useState<ChannelInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/rt/channels')
        .then((response) => (response.ok ? (response.json() as Promise<ChannelInfo[]>) : null))
        .then((list) => live && setChannels(list))
        .catch(() => live && setChannels(null));
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  return channels;
}

/** Bars for a histogram, in the order of its buckets. */
function Histogram({
  counts,
  buckets,
}: {
  counts: Record<string, number>;
  buckets: readonly string[];
}) {
  const total = buckets.reduce((sum, bucket) => sum + (counts[bucket] ?? 0), 0);
  if (total === 0) return <p className="muted">Chưa có số liệu.</p>;
  return (
    <ul className="bars">
      {buckets.map((bucket) => (
        <li key={bucket}>
          <span>{bucket}</span>
          <span className="bar" style={{ width: `${((counts[bucket] ?? 0) / total) * 100}%` }} />
          <span>{counts[bucket] ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The front page (docs/08 §7): who is in now, today's activity and missions, what needs someone,
 * how the game runs. Only totals; nothing here is about one person.
 */
export function OverviewPage({ me, go }: { me: AdminMeDto; go: (path: string) => void }) {
  const { data, error } = useLoad(() => api<DashboardDto>('GET', '/admin/stats/overview'), []);
  const channels = useOnline();
  const online = channels?.reduce((sum, channel) => sum + channel.players, 0) ?? null;
  const link = (path: string | undefined) => (event: React.MouseEvent) => {
    event.preventDefault();
    if (path) go(path);
  };

  return (
    <section className="dashboard">
      <h1>Tổng quan</h1>
      <p className="muted">
        Xin chào {me.displayName}. Mọi số liệu ở đây là số tổng, không theo từng người.
      </p>
      {error && <p className="error">{error}</p>}

      {data && data.alerts.length > 0 && (
        <ul className="alerts" data-testid="alerts">
          {data.alerts.map((alert) => (
            <li key={alert.text} data-level={alert.level}>
              {alert.link ? (
                <a href={href(alert.link)} onClick={link(alert.link)}>
                  {alert.text}
                </a>
              ) : (
                alert.text
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="tiles">
        <div className="tile" data-testid="online-now">
          <small>Đang online</small>
          <b>{online ?? '—'}</b>
          <span className="muted">
            {channels === null
              ? 'Không đọc được máy chủ realtime'
              : channels.length === 0
                ? 'Chưa có kênh nào mở'
                : channels.map((c) => `Kênh ${c.channel}: ${c.players}`).join(' · ')}
          </span>
        </div>
        {data && (
          <>
            <div className="tile">
              <small>Người chơi hôm nay</small>
              <b>{data.today.activeUsers}</b>
              <span className="muted">{data.today.newUsers} người mới</span>
            </div>
            <div className="tile">
              <small>Lượt vào</small>
              <b>{data.today.sessions.desktop + data.today.sessions.mobile}</b>
              <span className="muted">
                Máy tính {data.today.sessions.desktop} · điện thoại {data.today.sessions.mobile}
                {data.today.medianSession && ` · thường ở ${data.today.medianSession}`}
              </span>
            </div>
            <div className="tile">
              <small>Giao lưu hôm nay</small>
              <b>{data.today.chats + data.today.emotes}</b>
              <span className="muted">
                {data.today.chats} tin chat · {data.today.emotes} biểu cảm · {data.today.seats} lượt
                ngồi
              </span>
            </div>
          </>
        )}
      </div>

      {data && (
        <>
          <h2>Nhiệm vụ hôm nay</h2>
          {data.missions.length === 0 ? (
            <p className="muted">Hôm nay không có nhiệm vụ nào.</p>
          ) : (
            <table data-testid="missions-today">
              <thead>
                <tr>
                  <th>Nhiệm vụ</th>
                  <th>Trạng thái</th>
                  <th>Tham gia</th>
                  <th>Hoàn thành</th>
                  <th>Thời gian trung vị</th>
                </tr>
              </thead>
              <tbody>
                {data.missions.map((mission) => (
                  <tr key={mission.id}>
                    <td>
                      <a
                        href={href(`/missions/${mission.id}/results`)}
                        onClick={link(`/missions/${mission.id}/results`)}
                      >
                        {mission.title.vi}
                      </a>
                    </td>
                    <td>{STATE_LABEL[mission.state] ?? mission.state}</td>
                    <td>{mission.participants}</td>
                    <td>
                      {mission.completions}
                      {mission.participants > 0 &&
                        ` (${Math.round((mission.completions / mission.participants) * 100)}%)`}
                    </td>
                    <td>{duration(mission.medianDurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>7 ngày qua</h2>
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Người chơi</th>
                <th>Người mới</th>
                <th>Quay lại hôm sau</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{day.activeUsers}</td>
                  <td>{day.newUsers}</td>
                  <td>
                    {day.returnedNextDay === null
                      ? '—'
                      : `${day.returnedNextDay}${day.activeUsers > 0 ? ` (${Math.round((day.returnedNextDay / day.activeUsers) * 100)}%)` : ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Kỹ thuật hôm nay</h2>
          <div className="grid2">
            <div>
              <h3>Thời gian tải thế giới</h3>
              <Histogram counts={data.tech.worldLoad} buckets={LOAD_BUCKETS} />
            </div>
            <div>
              <h3>Khung hình/giây — máy tính · điện thoại</h3>
              <Histogram counts={data.tech.fps.desktop ?? {}} buckets={FPS_BUCKETS} />
              <Histogram counts={data.tech.fps.mobile ?? {}} buckets={FPS_BUCKETS} />
            </div>
          </div>
          <p className="muted">Lỗi phía trình duyệt hôm nay: {data.tech.errors}</p>
        </>
      )}
    </section>
  );
}
