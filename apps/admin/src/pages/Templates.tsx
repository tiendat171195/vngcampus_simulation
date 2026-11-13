import type { TemplateDto } from '@campus/shared';
import { useState } from 'react';
import { api } from '../api';
import { useLoad } from '../hooks';

/**
 * Mission templates (docs/08 §4.5): start a mission from one, or let the nightly job use the
 * switched-on ones when nobody planned tomorrow.
 */
export function TemplatesPage({ go }: { go: (path: string) => void }) {
  const { data, error, reload } = useLoad(() => api<TemplateDto[]>('GET', '/admin/templates'), []);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const run = (action: () => Promise<unknown>, text: string) => {
    setMessage(null);
    action().then(
      () => {
        setMessage({ text, error: false });
        reload();
      },
      (failure: Error) => setMessage({ text: failure.message, error: true }),
    );
  };

  return (
    <section>
      <div className="row">
        <h1>Mẫu nhiệm vụ</h1>
        <span className="spacer" />
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            api<{ missionId: string | null }>('POST', '/admin/missions/autofill').then(
              ({ missionId }) =>
                missionId
                  ? go(`/missions/${missionId}`)
                  : setMessage({
                      text: 'Không điền: ngày mai đã có nhiệm vụ ngày, tự điền đang tắt, hoặc không có mẫu nào dùng được.',
                      error: false,
                    }),
              (failure: Error) => setMessage({ text: failure.message, error: true }),
            );
          }}
        >
          Tự điền ngày mai ngay
        </button>
      </div>
      <p className="muted">
        Lúc 23:00 mỗi tối, nếu ngày mai chưa có nhiệm vụ ngày, hệ thống chọn mẫu đang bật lâu chưa
        dùng nhất (không lặp lại trong số ngày đặt ở Cấu hình), giữ nguyên khung giờ và xuất bản.
        Lưu một nhiệm vụ thành mẫu bằng nút "Lưu làm mẫu" trong trình soạn.
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className={message.error ? 'error' : 'ok'}>{message.text}</p>}
      <table data-testid="templates">
        <thead>
          <tr>
            <th>Mẫu</th>
            <th>Nhiệm vụ</th>
            <th>Mục tiêu</th>
            <th>Điểm</th>
            <th>Dùng lần cuối</th>
            <th>Tự điền</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((template) => (
            <tr key={template.id}>
              <td>
                {template.name}
                {template.tags.length > 0 && (
                  <small className="muted"> · {template.tags.join(', ')}</small>
                )}
                {template.broken && <small className="error"> · cần sửa</small>}
              </td>
              <td>{template.title.vi}</td>
              <td>{template.objectives}</td>
              <td>{template.points}</td>
              <td>{template.lastUsedOn ?? '—'}</td>
              <td>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={template.active}
                    aria-label={`Dùng ${template.name} khi tự điền`}
                    onChange={(event) =>
                      run(
                        () =>
                          api('PATCH', `/admin/templates/${template.id}`, {
                            active: event.target.checked,
                          }),
                        event.target.checked ? 'Đã bật cho tự điền.' : 'Đã tắt khỏi tự điền.',
                      )
                    }
                  />
                </label>
              </td>
              <td className="row">
                <button
                  type="button"
                  disabled={template.broken}
                  onClick={() => go(`/missions/new?template=${template.id}`)}
                >
                  Dùng mẫu
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (window.confirm(`Xoá mẫu "${template.name}"?`))
                      run(() => api('DELETE', `/admin/templates/${template.id}`), 'Đã xoá mẫu.');
                  }}
                >
                  Xoá
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && (
        <p className="muted">Chưa có mẫu nào. Mở một nhiệm vụ và bấm "Lưu làm mẫu".</p>
      )}
    </section>
  );
}
