import { useCallback, useEffect, useState } from 'react';
import { useSession } from './game/core/session';
import { useSettings } from './game/core/settings';
import { useDebugStore } from './game/debug/debugStore';
import { GameCanvas } from './game/GameCanvas';
import { loadGuest } from './game/net/identity';
import { net } from './game/net/net';
import { ActionBar, NoticeToast } from './ui/ActionBar';
import { AreaToast } from './ui/AreaToast';
import { ChatBox } from './ui/ChatBox';
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

  // A hidden tab shows as away to the others.
  useEffect(() => {
    const report = () => net.setAway(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, []);

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
          anim: remote.anim,
          emote: remote.emote,
          emoteSeq: remote.emoteSeq,
          seated: [...net.seats.values()].includes(remote.sessionId),
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
      {playing && <NoticeToast />}
      {playing && following && <ActionBar />}
      {playing && <ChatBox />}
      {playing && following && showHints && (
        <p className="hint">
          WASD đi · Shift chạy · Space nhảy · 1–6 biểu cảm · E tương tác · Enter trò chuyện
        </p>
      )}
      {playing && <ConnectionBanner onRetry={connect} />}
      {playing && <Toolbar />}
    </>
  );
}
