import { DebugPanel } from './game/debug/DebugPanel';
import { GameCanvas } from './game/GameCanvas';

export function App() {
  return (
    <>
      <GameCanvas />
      <DebugPanel />
    </>
  );
}
