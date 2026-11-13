import type { AdminMeDto, Permission } from '@campus/shared';
import { useEffect, useState } from 'react';
import { ApiFailure, api, gameUrl } from './api';
import { usePath } from './hooks';
import { AnnouncementsPage } from './pages/Announcements';
import { AuditPage } from './pages/Audit';
import { MissionEditorPage } from './pages/MissionEditor';
import { MissionsPage } from './pages/Missions';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { TemplatesPage } from './pages/Templates';
import { UserDetailPage, UsersPage } from './pages/Users';

type Gate =
  | { state: 'checking' }
  | { state: 'signed-out' }
  | { state: 'forbidden' }
  | { state: 'in'; me: AdminMeDto };

const NAV: Array<{ path: string; label: string; needs: Permission }> = [
  { path: '/', label: 'Tổng quan', needs: 'dashboard' },
  { path: '/missions', label: 'Nhiệm vụ', needs: 'missions' },
  { path: '/templates', label: 'Mẫu nhiệm vụ', needs: 'missions' },
  { path: '/announcements', label: 'Thông báo', needs: 'announcements' },
  { path: '/users', label: 'Người dùng', needs: 'moderation' },
  { path: '/settings', label: 'Cấu hình', needs: 'config' },
  { path: '/audit', label: 'Nhật ký thao tác', needs: 'dashboard' },
];

/**
 * The admin (docs/08): who is signed in, what they may open, and the page for the address. The
 * server checks every permission again; hiding what is not allowed is only a courtesy.
 */
export function App() {
  const [gate, setGate] = useState<Gate>({ state: 'checking' });
  const [path, go] = usePath();

  useEffect(() => {
    api<AdminMeDto>('GET', '/admin/me').then(
      (me) => setGate({ state: 'in', me }),
      (failure: unknown) =>
        setGate({
          state:
            failure instanceof ApiFailure && failure.status === 403 ? 'forbidden' : 'signed-out',
        }),
    );
  }, []);

  if (gate.state === 'checking') return <p className="centre">Đang kiểm tra đăng nhập…</p>;
  if (gate.state !== 'in')
    return (
      <main className="centre card">
        <h1>VNG Campus Online — Quản trị</h1>
        {gate.state === 'forbidden' ? (
          <p>Tài khoản này không có quyền quản trị. Nhờ một quản trị viên cấp quyền cho bạn.</p>
        ) : (
          <p>Hãy đăng nhập bằng tài khoản công ty trong game, rồi quay lại trang này.</p>
        )}
        <a className="button" href={gameUrl()}>
          Mở game để đăng nhập
        </a>
      </main>
    );

  const { me } = gate;
  const allowed = NAV.filter((item) => me.permissions.includes(item.needs));
  const userId = /^\/users\/([0-9a-f-]{36})$/.exec(path)?.[1];
  const missionId = /^\/missions\/([0-9a-f-]{36})$/.exec(path)?.[1];
  const missions = me.permissions.includes('missions');
  let page = <OverviewPage me={me} />;
  if (missions && path === '/missions') page = <MissionsPage go={go} />;
  else if (missions && path === '/missions/new')
    page = <MissionEditorPage key="new" id={null} go={go} />;
  else if (missions && missionId)
    page = <MissionEditorPage key={missionId} id={missionId} go={go} />;
  else if (userId && me.permissions.includes('moderation'))
    page = <UserDetailPage id={userId} me={me} go={go} />;
  else if (path === '/users' && me.permissions.includes('moderation')) page = <UsersPage go={go} />;
  else if (missions && path === '/templates') page = <TemplatesPage go={go} />;
  else if (path === '/announcements' && me.permissions.includes('announcements'))
    page = <AnnouncementsPage me={me} />;
  else if (path === '/settings' && me.permissions.includes('config'))
    page = <SettingsPage go={go} />;
  else if (path === '/audit') page = <AuditPage me={me} />;

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Mục quản trị">
        <p className="brand">Campus · Quản trị</p>
        {allowed.map((item) => (
          <a
            key={item.path}
            href={item.path}
            aria-current={
              path === item.path || (item.path !== '/' && path.startsWith(item.path))
                ? 'page'
                : undefined
            }
            onClick={(event) => {
              event.preventDefault();
              go(item.path);
            }}
          >
            {item.label}
          </a>
        ))}
        <p className="who">
          {me.displayName}
          <small>{ROLE_LABEL[me.role]}</small>
        </p>
      </nav>
      <main className="content">{page}</main>
    </div>
  );
}

export const ROLE_LABEL: Record<string, string> = {
  player: 'Người chơi',
  editor: 'Biên tập viên',
  moderator: 'Kiểm duyệt viên',
  admin: 'Quản trị viên',
};
