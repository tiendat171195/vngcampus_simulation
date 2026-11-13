import { useState } from 'react';
import { type ServiceState, useServiceStatus } from '../../useServiceStatus';
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
  { id: 'forecourt', label: 'Sân đón khách' },
];

const SERVICE_LABEL: Record<ServiceState, string> = {
  pending: 'đang kiểm tra',
  ok: 'hoạt động',
  error: 'mất kết nối',
};

/** Developer overlay: detach the camera, cut the buildings open, show the collision mesh. */
export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const cameraMode = useDebugStore((state) => state.cameraMode);
  const cutaway = useDebugStore((state) => state.cutaway);
  const showCollider = useDebugStore((state) => state.showCollider);
  const setCameraMode = useDebugStore((state) => state.setCameraMode);
  const setCutaway = useDebugStore((state) => state.setCutaway);
  const setShowCollider = useDebugStore((state) => state.setShowCollider);
  const goTo = useDebugStore((state) => state.goTo);
  const status = useServiceStatus();

  return (
    <div className="debug">
      <button
        type="button"
        className="debug-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Debug
      </button>
      {/* Kept mounted while closed so the game loop always has somewhere to write its numbers. */}
      <section className="panel" aria-label="Bảng điều khiển debug" hidden={!open}>
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
        <p className="stats" data-testid="service-status">
          <span className="dot" data-state={status.api} /> API {SERVICE_LABEL[status.api]}
          <span className="dot" data-state={status.realtime} /> Realtime{' '}
          {SERVICE_LABEL[status.realtime]}
          {status.visitors !== null && ` · ${status.visitors} người`}
        </p>
        <a href="/debug/map">Bản đồ 2D</a>
      </section>
    </div>
  );
}
