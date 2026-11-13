import { REPORT_REASONS, type ReportReason } from '@campus/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSession } from '../game/core/session';
import { net } from '../game/net/net';

/**
 * Reporting a colleague (docs/08 §6): a reason and an optional note. The server adds the chat
 * lines this player saw; nothing else about them is sent.
 */
export function ReportDialog() {
  const target = useSession((state) => state.reportTarget);
  const close = useSession((state) => state.openReport);
  const [reason, setReason] = useState<ReportReason>('harassment');
  const [note, setNote] = useState('');
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    net.report({ targetUserId: target.userId, reason, note: note.trim() });
    close(null);
  };

  return (
    <div className="modal-backdrop">
      <form
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        data-testid="report-dialog"
        onSubmit={submit}
      >
        <h2 id="report-title">Báo cáo {target.name}</h2>
        <fieldset>
          <legend>Lý do</legend>
          {(Object.keys(REPORT_REASONS) as ReportReason[]).map((key, index) => (
            <label key={key} className="report-reason">
              <input
                ref={index === 0 ? first : undefined}
                type="radio"
                name="reason"
                value={key}
                checked={reason === key}
                onChange={() => setReason(key)}
              />
              {REPORT_REASONS[key]}
            </label>
          ))}
        </fieldset>
        <label className="report-note">
          Ghi chú cho kiểm duyệt viên (không bắt buộc)
          <textarea
            value={note}
            maxLength={300}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="note">
          Kèm theo báo cáo là vài dòng chat gần đây mà bạn đã thấy. Người bị báo cáo không biết ai
          đã báo cáo.
        </p>
        <div className="report-actions">
          <button type="button" onClick={() => close(null)}>
            Huỷ
          </button>
          <button type="submit" className="primary">
            Gửi báo cáo
          </button>
        </div>
      </form>
    </div>
  );
}
