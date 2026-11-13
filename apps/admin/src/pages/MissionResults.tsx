import type { MissionResultsDto } from '@campus/shared';
import { api } from '../api';
import { useLoad, when } from '../hooks';

const TYPE_LABEL: Record<string, string> = {
  visit: 'Ghé điểm',
  collect: 'Thu thập',
  quiz: 'Quiz',
  social: 'Chào hỏi',
};

export const duration = (ms: number | null) => {
  if (ms === null) return '—';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes > 0 ? `${minutes} phút ${seconds} giây` : `${seconds} giây`;
};

/**
 * One mission's results (docs/08 §3): how many started and finished, where people stopped,
 * when they finished, and the fastest.
 */
export function MissionResultsPage({ id, go }: { id: string; go: (path: string) => void }) {
  const { data, error } = useLoad(
    () => api<MissionResultsDto>('GET', `/admin/missions/${id}/stats`),
    [id],
  );
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Đang tải…</p>;
  const most = Math.max(1, ...data.byHour.map((hour) => hour.completions));

  return (
    <section data-testid="mission-results">
      <button type="button" className="link" onClick={() => go(`/missions/${id}`)}>
        ← Về nhiệm vụ
      </button>
      <h1>Kết quả: {data.title.vi}</h1>
      <p className="muted">
        {when(data.startsAt)} → {when(data.endsAt)}
      </p>
      <div className="tiles">
        <div className="tile">
          <small>Tham gia</small>
          <b>{data.participants}</b>
        </div>
        <div className="tile">
          <small>Hoàn thành</small>
          <b>{data.completions}</b>
          <span className="muted">
            {data.participants > 0
              ? `${Math.round((data.completions / data.participants) * 100)}% người tham gia`
              : '—'}
          </span>
        </div>
        <div className="tile">
          <small>Thời gian trung vị</small>
          <b>{duration(data.medianDurationMs)}</b>
        </div>
        {data.community && (
          <div className="tile">
            <small>Mục tiêu chung</small>
            <b>
              {data.community.completions}/{data.community.target}
            </b>
            <span className="muted">{data.community.reached ? 'Đã đạt' : 'Chưa đạt'}</span>
          </div>
        )}
      </div>

      <h2>Từng mục tiêu</h2>
      <p className="muted">
        Số người đã xong mỗi mục tiêu: chỗ tụt mạnh là chỗ người chơi bỏ cuộc.
      </p>
      <ul className="bars funnel" data-testid="objective-funnel">
        <li>
          <span>Bắt đầu</span>
          <span className="bar" style={{ width: '100%' }} />
          <span>{data.participants}</span>
        </li>
        {data.objectives.map((objective) => (
          <li key={objective.id}>
            <span>
              {objective.title.vi} <small className="muted">({TYPE_LABEL[objective.type]})</small>
            </span>
            <span
              className="bar"
              style={{
                width: `${data.participants > 0 ? (objective.done / data.participants) * 100 : 0}%`,
              }}
            />
            <span>{objective.done}</span>
          </li>
        ))}
      </ul>

      <h2>Hoàn thành theo giờ</h2>
      {data.byHour.length === 0 ? (
        <p className="muted">Chưa ai hoàn thành.</p>
      ) : (
        <ul className="bars">
          {data.byHour.map((hour) => (
            <li key={hour.hour}>
              <span>{hour.hour}:00</span>
              <span className="bar" style={{ width: `${(hour.completions / most) * 100}%` }} />
              <span>{hour.completions}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Nhanh nhất</h2>
      {data.top.length === 0 ? (
        <p className="muted">Chưa có ai.</p>
      ) : (
        <ol className="top">
          {data.top.map((row) => (
            <li key={row.id}>
              {row.name} — {duration(row.score)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
