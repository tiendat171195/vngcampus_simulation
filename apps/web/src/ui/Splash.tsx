import { type FormEvent, useEffect, useState } from 'react';
import { type Phase, useSession } from '../game/core/session';
import { fallbackName, loadGuest, nameProblem, saveGuest } from '../game/net/identity';

const STEPS: Array<{ phase: Phase; label: string }> = [
  { phase: 'loading', label: 'Tải trò chơi' },
  { phase: 'building', label: 'Dựng campus' },
  { phase: 'ready', label: 'Sẵn sàng' },
];
const ORDER: Phase[] = ['loading', 'building', 'ready', 'playing'];

/**
 * First screen. It paints before the 3D code has downloaded, shows progress while the campus is
 * built behind it, then asks for a display name and waits for the player to step in: arriving
 * at the gate is the moment of "going to work".
 */
export function Splash() {
  const phase = useSession((state) => state.phase);
  const readyMs = useSession((state) => state.worldReadyMs);
  const setPhase = useSession((state) => state.setPhase);
  const setDisplayName = useSession((state) => state.setDisplayName);
  const [guest] = useState(loadGuest);
  const [name, setName] = useState(guest.name);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = phase === 'ready';

  const enter = (chosen: string) => {
    const issue = nameProblem(chosen);
    if (issue) {
      setProblem(issue);
      return;
    }
    const trimmed = chosen.trim();
    saveGuest({ id: guest.id, name: trimmed });
    setDisplayName(trimmed);
    setPhase('playing');
  };

  // `?enter` steps in automatically with the remembered (or a generated) name.
  useEffect(() => {
    if (!ready || !new URLSearchParams(window.location.search).has('enter')) return;
    const remembered = loadGuest();
    enter(remembered.name || fallbackName(remembered.id));
    // `enter` is recreated each render; running once when ready is what matters.
  }, [ready]);

  if (phase === 'playing') return null;
  const current = ORDER.indexOf(phase);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) enter(name);
  };

  return (
    <div className="splash" data-phase={phase}>
      <form className="splash-card" onSubmit={onSubmit}>
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

        <label className="splash-name">
          <span>Tên hiển thị</span>
          <input
            className="splash-name-input"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Ví dụ: Minh Anh"
            aria-invalid={problem !== null}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        {problem && <p className="splash-problem">{problem}</p>}

        <button type="submit" className="splash-enter" disabled={!ready}>
          {ready ? 'Vào campus' : 'Đang chuẩn bị…'}
        </button>
        {readyMs !== null && (
          <p className="splash-meta">Sẵn sàng sau {(readyMs / 1000).toFixed(1)} giây</p>
        )}
      </form>
      <p className="splash-credit">
        Bản dựng thử nghiệm · Dữ liệu bản đồ ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
