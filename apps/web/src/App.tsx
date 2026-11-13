import { DebugPanel } from './game/debug/DebugPanel';
import { useDebugStore } from './game/debug/debugStore';
import { GameCanvas } from './game/GameCanvas';
import { InputLayer } from './ui/InputLayer';

export function App() {
  const following = useDebugStore((state) => state.cameraMode === 'follow');

  return (
    <>
      <GameCanvas />
      {following && <InputLayer />}
      {following && (
        <p className="hint">
          WASD để đi · Shift để chạy · Space để nhảy · kéo chuột để xoay · lăn để zoom
        </p>
      )}
      <DebugPanel />
    </>
  );
}
