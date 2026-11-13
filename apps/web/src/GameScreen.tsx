import { useCallback, useEffect, useState } from 'react';
import { useSession } from './game/core/session';
import { useSettings } from './game/core/settings';
import { useDebugStore } from './game/debug/debugStore';
import { GameCanvas } from './game/GameCanvas';
import { loadGuest } from './game/net/identity';
import { net } from './game/net/net';
import { AreaToast } from './ui/AreaToast';
import { ConnectionBanner } from './ui/ConnectionBanner';
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

  // Join a channel once the player has stepped in from the splash screen.
  const connect = useCallback(() => {
    const { id } = loadGuest();
    const name = useSession.getState().displayName;
    const spawn = new URLSearchParams(window.location.search).get('spawn') ?? undefined;
    void net.leave().then(() => net.connect({ id, name }, { spawn }));
  }, []);

  useEffect(() => {
    if (playing) connect();
  }, [playing, connect]);

  useEffect(() => {
    const leave = () => void net.leave();
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, []);

  // `?debug` exposes a read-only view of the network state for end-to-end tests.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    (window as unknown as { campus: unknown }).campus = {
      remotes: () =>
        [...net.remotes.values()].map((remote) => ({
          name: remote.name,
          status: remote.status,
          ...remote.motion.latest,
        })),
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
      {playing && <ConnectionBanner onRetry={connect} />}
      {playing && <Toolbar />}
    </>
  );
}
