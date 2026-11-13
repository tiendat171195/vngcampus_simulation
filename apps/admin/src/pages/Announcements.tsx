import type { AdminMeDto, AnnouncementDto, AnnouncementLevel } from '@campus/shared';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { useLoad, when } from '../hooks';
import { fromVn, today, vnClock } from '../time';

export const LEVEL_LABEL: Record<AnnouncementLevel, string> = {
  ticker: 'Dòng chạy',
  popup: 'Hộp nổi',
  fullscreen: 'Toàn màn hình',
};
const STATE_LABEL: Record<AnnouncementDto['state'], string> = {
  scheduled: 'Hẹn giờ',
  live: 'Đang phát',
  ended: 'Đã hết',
  cancelled: 'Đã huỷ',
};
const DURATIONS = [15, 30, 60, 120, 240, 480, 1440, 4320];
const duration = (minutes: number) =>
  minutes < 60
    ? `${minutes} phút`
    : minutes < 1440
      ? `${minutes / 60} giờ`
      : `${minutes / 1440} ngày`;

/** Announcements to everyone in the campus (docs/08 §5): now or at a set time. */
export function AnnouncementsPage({ me }: { me: AdminMeDto }) {
  const { data, error, reload } = useLoad(
    () => api<AnnouncementDto[]>('GET', '/admin/announcements'),
    [],
  );
  const [level, setLevel] = useState<AnnouncementLevel>('ticker');
  const [text, setText] = useState('');
  const [later, setLater] = useState(false);
  const [date, setDate] = useState(today());
  const [clock, setClock] = useState(() => vnClock(new Date(Date.now() + 3_600_000)));
  const [minutes, setMinutes] = useState(60);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const admin = me.permissions.includes('config');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    api<AnnouncementDto>('POST', '/admin/announcements', {
      level,
      text: { vi: text.trim() },
      minutes,
      ...(later ? { startsAt: fromVn(date, clock) } : {}),
    }).then(
      (created) => {
        setText('');
        setMessage({
          text:
            created.state === 'live'
              ? 'Đã phát. Người chơi thấy trong vài giây.'
              : `Đã hẹn phát lúc ${when(created.startsAt)}.`,
          error: false,
        });
        reload();
      },
      (failure: Error) => setMessage({ text: failure.message, error: true }),
    );
  };

  return (
    <section>
      <h1>Thông báo</h1>
      <form className="panel grid2" onSubmit={submit} data-testid="announce-form">
        <label>
          Mức
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as AnnouncementLevel)}
          >
            <option value="ticker">Dòng chạy — một dòng trên đầu màn hình</option>
            <option value="popup">Hộp nổi — hiện một lần, bấm để đóng</option>
            {admin && <option value="fullscreen">Toàn màn hình — chỉ dùng cho bảo trì</option>}
          </select>
        </label>
        <label>
          Hiện trong
          <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
            {DURATIONS.map((value) => (
              <option key={value} value={value}>
                {duration(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          Nội dung
          <textarea
            value={text}
            maxLength={300}
            rows={3}
            required
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="field wide">
          <label className="check">
            <input type="radio" checked={!later} onChange={() => setLater(false)} /> Phát ngay
          </label>
          <label className="check">
            <input type="radio" checked={later} onChange={() => setLater(true)} /> Hẹn giờ
          </label>
          {later && (
            <span className="inline">
              <input
                type="date"
                aria-label="Ngày phát"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <input
                type="time"
                aria-label="Giờ phát"
                value={clock}
                onChange={(event) => setClock(event.target.value)}
              />
              <small className="muted">giờ Việt Nam</small>
            </span>
          )}
        </div>
        <div className="row wide">
          <button type="submit" className="primary" disabled={!text.trim()}>
            {later ? 'Hẹn giờ' : 'Phát ngay'}
          </button>
          {message && <p className={message.error ? 'error' : 'ok'}>{message.text}</p>}
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      <table data-testid="announcements">
        <thead>
          <tr>
            <th>Trạng thái</th>
            <th>Mức</th>
            <th>Nội dung</th>
            <th>Từ</th>
            <th>Đến</th>
            <th>Người tạo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((item) => (
            <tr key={item.id}>
              <td>
                <span className="tag" data-state={item.state === 'live' ? 'running' : item.state}>
                  {STATE_LABEL[item.state]}
                </span>
              </td>
              <td>{LEVEL_LABEL[item.level]}</td>
              <td>{item.text.vi}</td>
              <td>{when(item.startsAt)}</td>
              <td>{when(item.endsAt)}</td>
              <td>{item.createdByName ?? '—'}</td>
              <td>
                {(item.state === 'live' || item.state === 'scheduled') && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      api('POST', `/admin/announcements/${item.id}/cancel`).then(reload, () => {})
                    }
                  >
                    {item.state === 'live' ? 'Ngừng' : 'Huỷ'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p className="muted">Chưa có thông báo nào trong tuần qua.</p>}
    </section>
  );
}
