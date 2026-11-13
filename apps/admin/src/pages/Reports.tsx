import { REPORT_REASONS, type ReportDto, type ResolveReport } from '@campus/shared';
import { useState } from 'react';
import { api } from '../api';
import { href, useLoad, when } from '../hooks';

const STATUS_LABEL: Record<ReportDto['status'], string> = {
  open: 'Chờ xử lý',
  dismissed: 'Bỏ qua',
  warned: 'Đã nhắc nhở',
  muted: 'Đã cấm chat',
  banned: 'Đã khoá',
};

const ACTIONS: Array<{ label: string; body: ResolveReport; confirm?: string; danger?: boolean }> = [
  { label: 'Bỏ qua', body: { action: 'dismiss' } },
  { label: 'Nhắc nhở', body: { action: 'warn' } },
  { label: 'Cấm chat 1 giờ', body: { action: 'mute', hours: 1 } },
  { label: 'Cấm chat 1 ngày', body: { action: 'mute', hours: 24 } },
  { label: 'Cấm chat 7 ngày', body: { action: 'mute', hours: 24 * 7 } },
  {
    label: 'Khoá tài khoản',
    body: { action: 'ban', hours: null },
    confirm: 'Khoá tài khoản này cho tới khi được gỡ?',
    danger: true,
  },
];

/**
 * The moderation queue (docs/08 §6): each report with the chat the reporter saw, and one click
 * to decide. A decision closes every open report about the same person.
 */
export function ReportsPage({ go }: { go: (path: string) => void }) {
  const [status, setStatus] = useState<'open' | 'handled'>('open');
  const { data, error, reload } = useLoad(
    () => api<ReportDto[]>('GET', `/admin/reports?status=${status}`),
    [status],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const decide = (report: ReportDto, action: (typeof ACTIONS)[number]) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setMessage(null);
    const note = notes[report.id]?.trim();
    api<{ status: string; closed: number }>('POST', `/admin/reports/${report.id}/resolve`, {
      ...action.body,
      ...(note ? { note } : {}),
    }).then(
      (result) => {
        setMessage({
          text: `${action.label}: đã đóng ${result.closed} báo cáo về ${report.target.name}.`,
          error: false,
        });
        reload();
      },
      (failure: Error) => setMessage({ text: failure.message, error: true }),
    );
  };

  return (
    <section>
      <div className="row">
        <h1>Báo cáo vi phạm</h1>
        <span className="spacer" />
        <label className="check">
          <input type="radio" checked={status === 'open'} onChange={() => setStatus('open')} /> Chờ
          xử lý
        </label>
        <label className="check">
          <input
            type="radio"
            checked={status === 'handled'}
            onChange={() => setStatus('handled')}
          />{' '}
          Đã xử lý
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {message && (
        <p className={message.error ? 'error' : 'ok'} role="status">
          {message.text}
        </p>
      )}
      {data?.length === 0 && (
        <p className="muted">
          {status === 'open' ? 'Không có báo cáo nào chờ xử lý.' : 'Chưa xử lý báo cáo nào.'}
        </p>
      )}
      <div className="reports" data-testid="reports">
        {(data ?? []).map((report) => (
          <article key={report.id} className="panel report" data-testid="report">
            <header className="row">
              <b>
                <a
                  href={href(`/users/${report.target.id}`)}
                  onClick={(event) => {
                    event.preventDefault();
                    go(`/users/${report.target.id}`);
                  }}
                >
                  {report.target.name}
                </a>
              </b>
              <span className="tag">{REPORT_REASONS[report.reason]}</span>
              {report.target.status !== 'active' && (
                <span className="tag" data-state="draft">
                  {report.target.status === 'banned' ? 'đang bị khoá' : 'đang bị cấm chat'}
                </span>
              )}
              {report.targetReports > 0 && (
                <span className="muted">· {report.targetReports} báo cáo khác</span>
              )}
              <span className="spacer" />
              <small className="muted">
                {report.reporter?.name ?? 'Ẩn danh'} · {when(report.createdAt)}
              </small>
            </header>
            {report.note && <p>“{report.note}”</p>}
            {report.context.length > 0 ? (
              <ol className="transcript" aria-label="Đoạn chat người báo cáo đã thấy">
                {report.context.map((line) => (
                  <li key={`${line.at}${line.name}${line.text}`} data-target={line.byTarget}>
                    <small>{when(line.at)}</small> <b>{line.name}:</b> {line.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Không có đoạn chat kèm theo.</p>
            )}
            {report.status === 'open' ? (
              <>
                <input
                  className="report-note"
                  placeholder="Lý do (người bị phạt sẽ thấy)"
                  aria-label="Lý do quyết định"
                  maxLength={300}
                  value={notes[report.id] ?? ''}
                  onChange={(event) => setNotes({ ...notes, [report.id]: event.target.value })}
                />
                <div className="row">
                  {ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className={action.danger ? 'danger' : undefined}
                      onClick={() => decide(report, action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                {STATUS_LABEL[report.status]} bởi {report.handledByName ?? '—'} lúc{' '}
                {when(report.handledAt)}
                {report.resolution && ` — ${report.resolution}`}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
