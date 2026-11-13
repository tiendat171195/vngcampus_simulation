import type { AdminMissionSummary, OperationalSettings, SettingsPatch } from '@campus/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLoad, when } from '../hooks';

/**
 * Settings and kill switches (docs/08 §5), admins only. Everything takes effect in the game
 * within a few seconds and is written to the audit log.
 */
export function SettingsPage({ go }: { go: (path: string) => void }) {
  const loaded = useLoad(() => api<OperationalSettings>('GET', '/admin/settings'), []);
  const running = useLoad(() => {
    const now = new Date().toISOString();
    return api<AdminMissionSummary[]>('GET', `/admin/missions?from=${now}&to=${now}`);
  }, []);
  const [settings, setSettings] = useState<OperationalSettings | null>(null);
  const [holidays, setHolidays] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!loaded.data) return;
    setSettings(loaded.data);
    setHolidays(loaded.data.holidays.join('\n'));
  }, [loaded.data]);

  if (loaded.error) return <p className="error">{loaded.error}</p>;
  if (!settings) return <p className="muted">Đang tải…</p>;

  const save = (patch: SettingsPatch, done: string) => {
    setMessage(null);
    api<OperationalSettings>('PUT', '/admin/settings', patch).then(
      (saved) => {
        setSettings(saved);
        setHolidays(saved.holidays.join('\n'));
        setMessage({ text: done, error: false });
      },
      (failure: Error) => setMessage({ text: failure.message, error: true }),
    );
  };
  const live = (running.data ?? []).filter((mission) => mission.state === 'running');

  return (
    <section>
      <h1>Cấu hình</h1>
      {message && <p className={message.error ? 'error' : 'ok'}>{message.text}</p>}

      <h2>Công tắc khẩn</h2>
      <div className="panel switches" data-testid="kill-switches">
        <div className="row">
          <span>
            <b>Chat toàn campus:</b> {settings.chatEnabled ? 'đang bật' : 'đang TẮT'}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className={settings.chatEnabled ? 'danger' : 'primary'}
            onClick={() => {
              if (settings.chatEnabled && !window.confirm('Tắt chat cho mọi người?')) return;
              save(
                { chatEnabled: !settings.chatEnabled },
                settings.chatEnabled ? 'Đã tắt chat.' : 'Đã bật lại chat.',
              );
            }}
          >
            {settings.chatEnabled ? 'Tắt chat' : 'Bật lại chat'}
          </button>
        </div>
        <div className="row">
          <label className="grow">
            <span>
              <b>Bảo trì:</b>{' '}
              {settings.maintenance.on ? 'đang BẬT — chỉ nhân viên vào được' : 'tắt'}
            </span>
            <input
              value={settings.maintenance.message}
              maxLength={300}
              aria-label="Lời nhắn bảo trì"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  maintenance: { ...settings.maintenance, message: event.target.value },
                })
              }
            />
          </label>
          <button
            type="button"
            className={settings.maintenance.on ? 'primary' : 'danger'}
            disabled={!settings.maintenance.message.trim()}
            onClick={() => {
              const on = !settings.maintenance.on;
              if (on && !window.confirm('Bật bảo trì? Người chơi mới sẽ không vào được.')) return;
              save(
                { maintenance: { ...settings.maintenance, on } },
                on ? 'Đã bật bảo trì.' : 'Đã tắt bảo trì.',
              );
            }}
          >
            {settings.maintenance.on ? 'Tắt bảo trì' : 'Bật bảo trì'}
          </button>
        </div>
        <div>
          <b>Nhiệm vụ đang chạy:</b>{' '}
          {live.length === 0
            ? 'không có.'
            : live.map((mission) => (
                <button
                  key={mission.id}
                  type="button"
                  className="link"
                  onClick={() => go(`/missions/${mission.id}`)}
                >
                  {mission.title.vi} (đến {when(mission.endsAt)}) — mở để kết thúc sớm
                </button>
              ))}
        </div>
      </div>

      <h2>Cấu hình chung</h2>
      <form
        className="panel grid2"
        onSubmit={(event) => {
          event.preventDefault();
          save(
            {
              rewardCap: settings.rewardCap,
              autofill: settings.autofill,
              holidays: holidays
                .split(/[\s,]+/)
                .map((line) => line.trim())
                .filter(Boolean),
            },
            'Đã lưu cấu hình.',
          );
        }}
      >
        <label>
          Thưởng tối đa mỗi nhiệm vụ (điểm, tính cả giờ vàng)
          <input
            type="number"
            min={10}
            max={100000}
            value={settings.rewardCap}
            onChange={(event) =>
              setSettings({ ...settings, rewardCap: Number(event.target.value) })
            }
          />
        </label>
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autofill.enabled}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  autofill: { ...settings.autofill, enabled: event.target.checked },
                })
              }
            />{' '}
            Tự điền ngày trống từ mẫu (23:00)
          </label>
          <label>
            Không dùng lại một mẫu trong (ngày)
            <input
              type="number"
              min={0}
              max={365}
              value={settings.autofill.avoidDays}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  autofill: { ...settings.autofill, avoidDays: Number(event.target.value) },
                })
              }
            />
          </label>
        </div>
        <label className="wide">
          Ngày nghỉ (không làm đứt chuỗi ngày), mỗi dòng một ngày YYYY-MM-DD
          <textarea
            rows={5}
            value={holidays}
            onChange={(event) => setHolidays(event.target.value)}
          />
        </label>
        <div className="row wide">
          <button type="submit" className="primary">
            Lưu cấu hình
          </button>
        </div>
      </form>
      <p className="muted">
        Sức chứa kênh, chế độ khách và domain email đặt bằng biến môi trường lúc triển khai (xem
        .env.example).
      </p>
    </section>
  );
}
