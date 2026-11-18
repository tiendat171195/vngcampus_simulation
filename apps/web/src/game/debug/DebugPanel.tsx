import { type ServiceState, useServiceStatus } from '../../useServiceStatus';
import { useSession } from '../core/session';
import type { LevelId } from '../world/context';
import { playerSink, statsSink, useDebugStore, type ViewpointId } from './debugStore';

const CUTAWAYS: Array<{ level: LevelId; label: string }> = [
  { level: 'ROOF', label: 'Có mái' },
  { level: 'F3', label: 'Tầng 3' },
  { level: 'F2', label: 'Tầng 2' },
  { level: 'F1', label: 'Tầng trệt' },
];

const VIEWPOINTS: Array<{ id: ViewpointId; label: string }> = [
  { id: 'overview', label: 'Toàn cảnh' },
  { id: 'gate', label: 'Cổng' },
  { id: 'atrium', label: 'Atrium' },
  { id: 'pool', label: 'Hồ bơi' },
  { id: 'riverside', label: 'Ven sông' },
  { id: 'forecourt', label: 'Sân vườn' },
];

const CROWDS = [0, 25, 50, 100, 200];

const SERVICE_LABEL: Record<ServiceState, string> = {
  pending: 'đang kiểm tra',
  ok: 'hoạt động',
  error: 'mất kết nối',
};

/**
 * Developer overlay: detach the camera, cut the buildings open, show the collision mesh, add a
 * crowd. Kept mounted while hidden so the game loop always has somewhere to write its numbers.
 */
export function DebugPanel({ hidden }: { hidden: boolean }) {
  const cameraMode = useDebugStore((state) => state.cameraMode);
  const cutaway = useDebugStore((state) => state.cutaway);
  const showCollider = useDebugStore((state) => state.showCollider);
  const bots = useDebugStore((state) => state.bots);
  const { setCameraMode, setCutaway, setShowCollider, setBots, goTo } = useDebugStore.getState();
  const readyMs = useSession((state) => state.worldReadyMs);
  const status = useServiceStatus();

  return (
    <section className="panel" aria-label="Bảng điều khiển debug" hidden={hidden}>
      <div className="group">
        <span className="group-label">Camera</span>
        <div className="buttons">
          <button
            type="button"
            aria-pressed={cameraMode === 'follow'}
            onClick={() => setCameraMode('follow')}
          >
            Theo nhân vật
          </button>
          <button
            type="button"
            aria-pressed={cameraMode === 'free'}
            onClick={() => setCameraMode('free')}
          >
            Tự do
          </button>
        </div>
      </div>

      <div className="group">
        <span className="group-label">Góc nhìn (camera tự do)</span>
        <div className="buttons">
          {VIEWPOINTS.map((view) => (
            <button key={view.id} type="button" onClick={() => goTo(view.id)}>
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="group-label">Cắt lớp</span>
        <div className="buttons">
          {CUTAWAYS.map((option) => (
            <button
              key={option.level}
              type="button"
              aria-pressed={cutaway === option.level}
              onClick={() => setCutaway(option.level)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="group-label">Avatar giả (đo hiệu năng đám đông)</span>
        <div className="buttons">
          {CROWDS.map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={bots === count}
              onClick={() => setBots(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={showCollider}
          onChange={(event) => setShowCollider(event.target.checked)}
        />
        Hiện lưới va chạm
      </label>

      <p
        className="stats"
        data-testid="player-info"
        ref={(element) => {
          playerSink.element = element;
        }}
      >
        —
      </p>
      <p
        className="stats"
        data-testid="render-stats"
        ref={(element) => {
          statsSink.element = element;
        }}
      >
        —
      </p>
      <p className="stats">
        Dựng xong sau {readyMs === null ? '—' : `${(readyMs / 1000).toFixed(2)} s`}
      </p>
      <p className="stats" data-testid="service-status">
        <span className="dot" data-state={status.api} /> API {SERVICE_LABEL[status.api]}
        <span className="dot" data-state={status.realtime} /> Realtime{' '}
        {SERVICE_LABEL[status.realtime]}
        {status.visitors !== null && ` · ${status.visitors} người`}
      </p>
      <a href="/debug/map">Bản đồ 2D</a>
    </section>
  );
}
