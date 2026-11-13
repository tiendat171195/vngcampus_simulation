import { useEffect, useState } from 'react';
import { useSession } from './game/core/session';
import { useSettings } from './game/core/settings';
import { useDebugStore } from './game/debug/debugStore';
import { GameCanvas } from './game/GameCanvas';
import { AreaToast } from './ui/AreaToast';
import { InputLayer } from './ui/InputLayer';
import { MiniMap } from './ui/MiniMap';
import { Toolbar } from './ui/Toolbar';

/** Everything that needs three.js. Loaded on demand, while the splash screen is showing. */
export default function GameScreen() {
  const playing = useSession((state) => state.phase === 'playing');
  const following = useDebugStore((state) => state.cameraMode === 'follow');
  const showHints = useSettings((state) => state.showHints);
  const [mountCanvas, setMountCanvas] = useState(false);

  useEffect(() => {
    const { phase, setPhase } = useSession.getState();
    if (phase === 'loading') setPhase('building');
    // Building the world blocks the main thread for a moment; let the splash paint first.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMountCanvas(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  return (
    <>
      {mountCanvas && <GameCanvas />}
      {playing && following && <InputLayer />}
      {playing && <MiniMap />}
      {playing && <AreaToast />}
      {playing && following && showHints && (
        <p className="hint">
          WASD để đi · Shift để chạy · Space để nhảy · kéo chuột để xoay · lăn để zoom
        </p>
      )}
      {playing && <Toolbar />}
    </>
  );
}
