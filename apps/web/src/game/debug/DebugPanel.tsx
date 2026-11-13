import { type ServiceState, useServiceStatus } from '../../useServiceStatus';
import type { LevelId } from '../world/context';
import { statsSink, useDebugStore, type ViewpointId } from './debugStore';

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
  { id: 'forecourt', label: 'Sân đón khách' },
];

const SERVICE_LABEL: Record<ServiceState, string> = {
  pending: 'đang kiểm tra',
  ok: 'hoạt động',
  error: 'mất kết nối',
};

/** Developer overlay for looking around the greybox world. */
export function DebugPanel() {
  const cutaway = useDebugStore((state) => state.cutaway);
  const showCollider = useDebugStore((state) => state.showCollider);
  const setCutaway = useDebugStore((state) => state.setCutaway);
  const setShowCollider = useDebugStore((state) => state.setShowCollider);
  const goTo = useDebugStore((state) => state.goTo);
  const status = useServiceStatus();

  return (
    <section className="panel" aria-label="Bảng điều khiển debug">
      <h1>VNG Campus Online</h1>
      <p>
        Bản dựng khối (greybox) từ dữ liệu bản đồ v0. Kéo để di chuyển, chuột phải hoặc hai ngón để
        xoay, lăn để zoom.
      </p>

      <div className="group">
        <span className="group-label">Góc nhìn</span>
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
        data-testid="render-stats"
        ref={(element) => {
          statsSink.element = element;
        }}
      >
        —
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
