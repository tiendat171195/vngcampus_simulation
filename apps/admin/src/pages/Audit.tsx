import type { AdminMeDto, AuditEntryDto } from '@campus/shared';
import { useState } from 'react';
import { api } from '../api';
import { useLoad, when } from '../hooks';

const ACTIONS: Record<string, string> = {
  'user.role': 'Đổi vai trò',
  'sanction.mute': 'Cấm chat',
  'sanction.ban': 'Khoá tài khoản',
  'sanction.lift': 'Gỡ án phạt',
};

/** Who did what and when (docs/08 §2): one's own entries, or everyone's for admins. */
export function AuditPage({ me }: { me: AdminMeDto }) {
  const everyone = me.permissions.includes('auditAll');
  const [all, setAll] = useState(everyone);
  const { data, error } = useLoad(
    () => api<AuditEntryDto[]>('GET', `/admin/audit?all=${all ? 1 : 0}`),
    [all],
  );
  return (
    <section>
      <h1>Nhật ký thao tác</h1>
      {everyone && (
        <label className="check">
          <input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} />{' '}
          Của mọi người
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <table data-testid="audit">
        <thead>
          <tr>
            <th>Lúc</th>
            <th>Ai</th>
            <th>Việc</th>
            <th>Đối tượng</th>
            <th>Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((entry) => (
            <tr key={entry.id}>
              <td>{when(entry.createdAt)}</td>
              <td>{entry.actorName ?? '—'}</td>
              <td>{ACTIONS[entry.action] ?? entry.action}</td>
              <td>
                <code>{entry.entityType}</code> {entry.entityId.slice(0, 8)}
              </td>
              <td>
                <code className="diff">{JSON.stringify(entry.diff)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p className="muted">Chưa có thao tác nào.</p>}
    </section>
  );
}
