import type { AnnouncementView } from '@campus/shared';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../game/core/session';

const DISMISSED_KEY = 'campus.announcements.dismissed.v1';

function loadDismissed(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    // Private mode: it shows again next visit, which is fine.
  }
}

/**
 * Announcements from the admin (docs/08 §5): a line along the top, a box to close once, or a
 * screen-wide notice; and maintenance, while it lasts. A closed announcement stays closed on
 * this device.
 */
export function Announcements() {
  const ops = useSession((state) => state.ops);
  // Out of the room the news may be stale, and the connection banner has the top of the screen.
  const online = useSession((state) => state.net.status === 'online');
  const [dismissed, setDismissed] = useState(loadDismissed);
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    saveDismissed(next);
  };

  const button = useRef<HTMLButtonElement>(null);
  const ticker = ops.announcements.filter((a) => a.level === 'ticker');
  const open: AnnouncementView | undefined = ops.announcements.find(
    (a) => a.level !== 'ticker' && !dismissed.includes(a.id),
  );
  useEffect(() => {
    if (open) button.current?.focus();
  }, [open]);

  return (
    <>
      {online && (ticker.length > 0 || ops.maintenance) && (
        <div className="announce-strip" role="status" aria-live="polite">
          {ops.maintenance && <p className="announce-maintenance">🔧 {ops.maintenance}</p>}
          {ticker.length > 0 && (
            <p className="announce-ticker" data-testid="announce-ticker">
              <span>📣 {ticker.map((a) => a.text.vi).join('   ·   ')}</span>
            </p>
          )}
        </div>
      )}
      {open && (
        <div
          className={open.level === 'fullscreen' ? 'announce-fullscreen' : 'announce-backdrop'}
          role="dialog"
          aria-modal="true"
          aria-labelledby="announce-title"
        >
          <div className="announce-card" data-testid="announce-card">
            <h2 id="announce-title">Thông báo</h2>
            <p>{open.text.vi}</p>
            <button
              type="button"
              className="announce-ok"
              ref={button}
              onClick={() => dismiss(open.id)}
            >
              Đã hiểu
            </button>
          </div>
        </div>
      )}
    </>
  );
}
