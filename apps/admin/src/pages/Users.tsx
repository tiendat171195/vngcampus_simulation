import type { AdminMeDto, AdminUserDetailDto, AdminUserDto, SanctionDto } from '@campus/shared';
import { type FormEvent, useState } from 'react';
import { ROLE_LABEL } from '../App';
import { ApiFailure, api } from '../api';
import { useLoad, when } from '../hooks';

const STATUS_LABEL: Record<string, string> = {
  active: 'Bình thường',
  muted: 'Bị cấm chat',
  banned: 'Bị khoá',
};
const DURATIONS: Array<{ hours: number | null; label: string }> = [
  { hours: 1, label: '1 giờ' },
  { hours: 24, label: '1 ngày' },
  { hours: 24 * 7, label: '7 ngày' },
  { hours: null, label: 'Cho tới khi gỡ' },
];

function sanctionText(sanction: SanctionDto) {
  const kind =
    sanction.type === 'ban' ? 'Khoá tài khoản' : sanction.type === 'warn' ? 'Nhắc nhở' : 'Cấm chat';
  return `${kind} · ${sanction.endsAt ? `đến ${when(sanction.endsAt)}` : 'không thời hạn'}`;
}

/** Find people by name or email (docs/08 §3, Cộng đồng). */
export function UsersPage({ go }: { go: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, error } = useLoad(
    () =>
      api<AdminUserDto[]>(
        'GET',
        `/admin/users${submitted ? `?q=${encodeURIComponent(submitted)}` : ''}`,
      ),
    [submitted],
  );
  return (
    <section>
      <h1>Người dùng</h1>
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <input
          value={query}
          placeholder="Tìm theo tên hoặc email"
          aria-label="Tìm theo tên hoặc email"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Tìm</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table data-testid="users">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Email</th>
            <th>Vai trò</th>
            <th>Trạng thái</th>
            <th>Lần cuối vào</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((user) => (
            <tr key={user.id} className="clickable" onClick={() => go(`/users/${user.id}`)}>
              <td>
                <a
                  href={`/users/${user.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    go(`/users/${user.id}`);
                  }}
                >
                  {user.displayName}
                </a>
                {user.isGuest && <span className="tag">Khách</span>}
              </td>
              <td>{user.email ?? '—'}</td>
              <td>{ROLE_LABEL[user.role]}</td>
              <td data-status={user.status}>{STATUS_LABEL[user.status]}</td>
              <td>{when(user.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p className="muted">Không tìm thấy ai.</p>}
    </section>
  );
}

/** One person: stats, sanctions, role (docs/08 §6). */
export function UserDetailPage({
  id,
  me,
  go,
}: {
  id: string;
  me: AdminMeDto;
  go: (path: string) => void;
}) {
  const {
    data: user,
    error,
    reload,
  } = useLoad(() => api<AdminUserDetailDto>('GET', `/admin/users/${id}`), [id]);
  const [type, setType] = useState<'mute' | 'ban'>('mute');
  const [hours, setHours] = useState<number | null>(1);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({ text: done, error: false });
      reload();
    } catch (failure) {
      setMessage({
        text: failure instanceof ApiFailure ? failure.message : 'Có lỗi xảy ra.',
        error: true,
      });
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!user) return <p className="muted">Đang tải…</p>;
  const self = user.id === me.id;
  const onSanction = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => api('POST', `/admin/users/${id}/sanctions`, { type, hours, reason }),
      type === 'ban' ? 'Đã khoá tài khoản.' : 'Đã cấm chat.',
    );
    setReason('');
  };

  return (
    <section data-testid="user-detail">
      <button type="button" className="link" onClick={() => go('/users')}>
        ← Danh sách
      </button>
      <h1>
        {user.displayName} {user.isGuest && <span className="tag">Khách</span>}
      </h1>
      <p className="muted">
        {user.email ?? 'Không có email'} · {ROLE_LABEL[user.role]} · {STATUS_LABEL[user.status]} ·
        vào lần cuối {when(user.lastSeenAt)}
      </p>
      <p>
        Cấp {user.stats.level} · {user.stats.points} điểm · {user.stats.missionsCompleted} nhiệm vụ
        · chuỗi {user.stats.streakCurrent} ngày
      </p>
      {message && (
        <p className={message.error ? 'error' : 'ok'} role="status">
          {message.text}
        </p>
      )}

      {me.permissions.includes('roles') && !self && !user.isGuest && (
        <div className="panel">
          <h2>Vai trò</h2>
          <select
            aria-label="Vai trò"
            value={user.role}
            onChange={(event) =>
              void run(
                () => api('PATCH', `/admin/users/${id}`, { role: event.target.value }),
                'Đã đổi vai trò.',
              )
            }
          >
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="panel">
        <h2>Án phạt</h2>
        {user.sanctions.length === 0 && <p className="muted">Chưa từng bị phạt.</p>}
        <ul className="sanctions">
          {user.sanctions.map((sanction) => {
            const active = user.active.some((current) => current.id === sanction.id);
            return (
              <li key={sanction.id} data-active={active}>
                <span>
                  <b>{sanctionText(sanction)}</b> — {sanction.reason}
                  <small>
                    {' '}
                    (từ {when(sanction.startsAt)}
                    {sanction.revokedAt ? `, gỡ lúc ${when(sanction.revokedAt)}` : ''})
                  </small>
                </span>
                {active && (
                  <button
                    type="button"
                    onClick={() =>
                      void run(() => api('DELETE', `/admin/sanctions/${sanction.id}`), 'Đã gỡ.')
                    }
                  >
                    Gỡ
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!self && (
          <form className="sanction-form" onSubmit={onSanction}>
            <select
              aria-label="Loại án phạt"
              value={type}
              onChange={(event) => setType(event.target.value as 'mute' | 'ban')}
            >
              <option value="mute">Cấm chat</option>
              <option value="ban">Khoá tài khoản</option>
            </select>
            <select
              aria-label="Thời hạn"
              value={String(hours)}
              onChange={(event) =>
                setHours(event.target.value === 'null' ? null : Number(event.target.value))
              }
            >
              {DURATIONS.map((duration) => (
                <option key={duration.label} value={String(duration.hours)}>
                  {duration.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Lý do"
              placeholder="Lý do (người bị phạt sẽ thấy)"
              value={reason}
              minLength={3}
              maxLength={300}
              required
              onChange={(event) => setReason(event.target.value)}
            />
            <button type="submit">Áp dụng</button>
          </form>
        )}
      </div>
    </section>
  );
}
