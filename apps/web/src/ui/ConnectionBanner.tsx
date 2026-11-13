import { useSession } from '../game/core/session';

interface Props {
  onRetry(): void;
}

/** Tells the player when they are alone because the connection is not there. */
export function ConnectionBanner({ onRetry }: Props) {
  const status = useSession((state) => state.net.status);

  if (status === 'online' || status === 'idle') return null;
  const message = {
    connecting: 'Đang vào kênh…',
    reconnecting: 'Mất kết nối, đang thử lại…',
    offline: 'Không kết nối được máy chủ. Bạn vẫn đi dạo được, nhưng chưa thấy ai.',
    replaced: 'Tài khoản này vừa vào campus từ một tab hoặc thiết bị khác.',
  }[status];
  const action = status === 'offline' ? 'Thử lại' : status === 'replaced' ? 'Vào lại ở đây' : null;

  return (
    <div className="connection-banner" data-status={status} role="status">
      <span>{message}</span>
      {action && (
        <button type="button" onClick={onRetry}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Which channel the player is in and how many people are there. */
export function ChannelBadge() {
  const net = useSession((state) => state.net);
  if (net.status !== 'online' || net.channel === null) return null;
  return (
    <div className="channel-badge" data-testid="channel-badge">
      Campus {net.channel} · {net.players} người
    </div>
  );
}
