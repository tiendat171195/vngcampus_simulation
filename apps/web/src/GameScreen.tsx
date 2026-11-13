import { avatarFromSeed, formatAvatar } from '@campus/shared';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from './game/core/session';
import { useSettings } from './game/core/settings';
import { firstRunDone, markFirstRunDone, tutorialDone } from './game/core/tutorial';
import { useDebugStore } from './game/debug/debugStore';
import { GameCanvas } from './game/GameCanvas';
import { missionWorld, useMissions } from './game/missions/missionStore';
import { net } from './game/net/net';
import { currentUser, signIn } from './services/auth';
import { ActionBar, NoticeToast } from './ui/ActionBar';
import { AreaToast } from './ui/AreaToast';
import { AvatarEditor } from './ui/AvatarEditor';
import { ChatBox } from './ui/ChatBox';
import { ConnectionBanner } from './ui/ConnectionBanner';
import { InputLayer } from './ui/InputLayer';
import { MiniMap } from './ui/MiniMap';
import {
  MissionBanner,
  MissionComplete,
  MissionTracker,
  QuizDialog,
  WaypointCompass,
} from './ui/MissionHud';
import { ProfileCard } from './ui/ProfileCard';
import { Toolbar } from './ui/Toolbar';
import { Tutorial } from './ui/Tutorial';

/** Everything that needs three.js. Loaded on demand, while the splash screen is showing. */
export default function GameScreen() {
  const playing = useSession((state) => state.phase === 'playing');
  const following = useDebugStore((state) => state.cameraMode === 'follow');
  const showHints = useSettings((state) => state.showHints);
  const modal = useSession((state) => state.modal);
  const [firstRun, setFirstRun] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const endTutorial = useCallback(() => setTutorial(false), []);
  const steering = playing && following && modal === null;
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
  const connect = useCallback(async () => {
    const session = useSession.getState();
    // Entered alone because the API was down: sign in now, before joining.
    if (!currentUser()) {
      const result = await signIn(session.displayName);
      if (result.ok) session.setDisplayName(result.user.displayName);
    }
    // Dressed in the account's avatar, or the one everybody else derives from the user id.
    const user = currentUser();
    if (user) session.setAvatar(user.avatar || formatAvatar(avatarFromSeed(user.id)));
    const spawn = new URLSearchParams(window.location.search).get('spawn') ?? undefined;
    await net.leave();
    await net.connect({ spawn });
  }, []);

  useEffect(() => {
    if (playing) void connect();
  }, [playing, connect]);

  // First visit on this browser (docs/01 §4.1): choose a look, then three steps of tutorial.
  useEffect(() => {
    if (!playing || firstRunDone()) return;
    markFirstRunDone();
    if (!currentUser()?.avatar) {
      setFirstRun(true);
      useSession.getState().setModal('avatar');
    } else if (!tutorialDone()) setTutorial(true);
  }, [playing]);
  useEffect(() => {
    if (!firstRun || modal !== null) return;
    setFirstRun(false);
    if (!tutorialDone()) setTutorial(true);
  }, [firstRun, modal]);

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
      user: () => currentUser(),
      missions: () => useMissions.getState().missions,
      entities: () => missionWorld.entities,
      remotes: () =>
        [...net.remotes.values()].map((remote) => ({
          name: remote.name,
          tag: remote.tag,
          avatar: remote.avatar,
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
      {steering && <InputLayer />}
      {playing && <MiniMap />}
      {playing && <AreaToast />}
      {playing && <NoticeToast />}
      {steering && <ActionBar />}
      {playing && <ChatBox />}
      {playing && following && showHints && (
        <p className="hint">
          WASD đi · Shift chạy · Space nhảy · 1–6 biểu cảm · E tương tác · Enter trò chuyện
        </p>
      )}
      {playing && <ConnectionBanner onRetry={() => void connect()} />}
      {playing && <Toolbar />}
      {playing && modal === 'avatar' && <AvatarEditor firstRun={firstRun} />}
      {playing && <ProfileCard />}
      {playing && <MissionTracker />}
      {steering && <WaypointCompass />}
      {playing && modal === null && <MissionBanner />}
      {playing && <QuizDialog />}
      {playing && <MissionComplete />}
      {steering && tutorial && <Tutorial onFinish={endTutorial} />}
    </>
  );
}
