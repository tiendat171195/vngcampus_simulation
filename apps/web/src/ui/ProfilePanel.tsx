import type { DepartmentDto, UserDto } from '@campus/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useSession } from '../game/core/session';
import { nameProblem, saveName } from '../game/net/identity';
import { net } from '../game/net/net';
import { currentUser, deleteAccount, saveProfile, signOut } from '../services/auth';
import { loadDepartments, newRecoveryCode } from '../services/directory';
import { MissionHistory } from './ProgressHud';

/** One's own profile: name, avatar, department, title, privacy, recovery code, sign-out. */
export function ProfilePanel({ hidden }: { hidden: boolean }) {
  const setModal = useSession((state) => state.setModal);
  const setDisplayName = useSession((state) => state.setDisplayName);
  const [user, setUser] = useState<UserDto | null>(currentUser);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [name, setName] = useState(user?.displayName ?? '');
  const [departmentId, setDepartmentId] = useState(user?.departmentId ?? '');
  const [title, setTitle] = useState(user?.title ?? '');
  const [hide, setHide] = useState(user?.hidePresence ?? false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh values each time the panel opens.
  useEffect(() => {
    if (hidden) return;
    const fresh = currentUser();
    setUser(fresh);
    setName(fresh?.displayName ?? '');
    setDepartmentId(fresh?.departmentId ?? '');
    setTitle(fresh?.title ?? '');
    setHide(fresh?.hidePresence ?? false);
    setMessage(null);
    void loadDepartments().then((list) => {
      if (typeof list !== 'string') setDepartments(list);
    });
  }, [hidden]);

  if (!user) {
    return (
      <section className="panel" aria-label="Hồ sơ" hidden={hidden}>
        <p className="note">Chưa đăng nhập được — đang ở chế độ đi một mình.</p>
      </section>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (user.isGuest) {
      const issue = nameProblem(trimmed);
      if (issue) return setMessage({ text: issue, error: true });
    }
    setBusy(true);
    const result = await saveProfile({
      ...(user.isGuest && trimmed !== user.displayName ? { displayName: trimmed } : {}),
      departmentId: departmentId || null,
      title: title.trim() || null,
      hidePresence: hide,
    });
    setBusy(false);
    if (typeof result === 'string') return setMessage({ text: result, error: true });
    setUser(result);
    setDisplayName(result.displayName);
    if (result.isGuest) saveName(result.displayName);
    // The room learns the new name and online-list choice from the fresh token.
    void net.sendProfile();
    setMessage({ text: 'Đã lưu.', error: false });
  };

  return (
    <section className="panel profile-panel" aria-label="Hồ sơ" hidden={hidden}>
      <form onSubmit={(event) => void onSubmit(event)}>
        {user.isGuest ? (
          <label className="group">
            <span className="group-label">Tên hiển thị (khách)</span>
            <input
              className="profile-field"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : (
          <div className="group">
            <span className="group-label">Tài khoản công ty</span>
            <strong>{user.displayName}</strong>
            {user.email && <p className="note">{user.email}</p>}
          </div>
        )}

        <div className="group">
          <button type="button" onClick={() => setModal('avatar')}>
            Đổi avatar
          </button>
        </div>

        <label className="group">
          <span className="group-label">Phòng ban (không bắt buộc)</span>
          <select
            className="profile-field"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">— Không chọn —</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>

        <label className="group">
          <span className="group-label">Chức danh (không bắt buộc)</span>
          <input
            className="profile-field"
            value={title}
            maxLength={40}
            placeholder="Ví dụ: Kỹ sư phần mềm"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={hide}
            onChange={(event) => setHide(event.target.checked)}
          />
          Ẩn tôi khỏi danh sách online
        </label>
        <p className="note">Người đứng gần vẫn thấy bạn trong campus.</p>

        {message && (
          <p className={message.error ? 'splash-problem' : 'note'} role="status">
            {message.text}
          </p>
        )}
        <button type="submit" className="profile-save" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
        </button>
      </form>

      {user.isGuest && (
        <div className="group recovery">
          <span className="group-label">Mã khôi phục</span>
          {code ? (
            <>
              <code data-testid="recovery-code">{code}</code>
              <p className="note">
                Ghi lại mã này: nó giúp bạn vào lại tài khoản khách trên máy khác. Mã chỉ hiện một
                lần; mã cũ (nếu có) không còn dùng được.
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                void newRecoveryCode().then((result) => {
                  if (typeof result === 'string') setMessage({ text: result, error: true });
                  else setCode(result.recoveryCode);
                });
              }}
            >
              Tạo mã khôi phục
            </button>
          )}
        </div>
      )}

      <MissionHistory hidden={hidden} />

      <button
        type="button"
        className="profile-signout"
        onClick={() => {
          const lost =
            user.isGuest &&
            !window.confirm(
              'Tài khoản khách sẽ mất nếu bạn chưa ghi lại mã khôi phục. Vẫn đăng xuất?',
            );
          if (!lost) void signOut().then(() => window.location.reload());
        }}
      >
        Đăng xuất
      </button>
      <button
        type="button"
        className="profile-delete"
        onClick={() => {
          const typed = window.prompt(
            'Xoá vĩnh viễn tài khoản này cùng điểm, cấp, tiến độ nhiệm vụ và hồ sơ? Không thể hoàn tác.\nGõ XOÁ để xác nhận.',
          );
          if (!typed || !['XOÁ', 'XOA'].includes(typed.trim().toUpperCase())) return;
          void deleteAccount().then(async (problem) => {
            if (problem) {
              setMessage({ text: problem, error: true });
              return;
            }
            await net.leave();
            window.location.reload();
          });
        }}
      >
        Xoá tài khoản
      </button>
    </section>
  );
}
