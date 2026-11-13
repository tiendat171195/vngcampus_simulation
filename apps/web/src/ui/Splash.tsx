import { useEffect } from 'react';
import { type Phase, useSession } from '../game/core/session';

const STEPS: Array<{ phase: Phase; label: string }> = [
  { phase: 'loading', label: 'Tải trò chơi' },
  { phase: 'building', label: 'Dựng campus' },
  { phase: 'ready', label: 'Sẵn sàng' },
];
const ORDER: Phase[] = ['loading', 'building', 'ready', 'playing'];

/**
 * First screen. It paints before the 3D code has downloaded, shows progress while the campus is
 * built behind it, then waits for the player to step in: arriving at the gate is the moment of
 * "going to work".
 */
export function Splash() {
  const phase = useSession((state) => state.phase);
  const readyMs = useSession((state) => state.worldReadyMs);
  const setPhase = useSession((state) => state.setPhase);
  const ready = phase === 'ready';

  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') setPhase('playing');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, setPhase]);

  if (phase === 'playing') return null;
  const current = ORDER.indexOf(phase);

  return (
    <div className="splash" data-phase={phase}>
      <div className="splash-card">
        <p className="splash-kicker">Campus ảo</p>
        <h1>VNG Campus Online</h1>
        <p className="splash-lead">
          Đi làm bằng avatar, gặp đồng nghiệp đang online và cùng làm nhiệm vụ mỗi ngày.
        </p>

        <ol className="splash-steps" aria-label="Tiến trình tải">
          {STEPS.map((step) => {
            const index = ORDER.indexOf(step.phase);
            const state = index < current ? 'done' : index === current ? 'active' : 'todo';
            return (
              <li key={step.phase} data-state={state === 'active' && ready ? 'done' : state}>
                {step.label}
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          className="splash-enter"
          disabled={!ready}
          onClick={() => setPhase('playing')}
        >
          {ready ? 'Vào campus' : 'Đang chuẩn bị…'}
        </button>
        {readyMs !== null && (
          <p className="splash-meta">Sẵn sàng sau {(readyMs / 1000).toFixed(1)} giây</p>
        )}
      </div>
      <p className="splash-credit">
        Bản dựng thử nghiệm · Dữ liệu bản đồ ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
