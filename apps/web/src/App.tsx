import { lazy, Suspense } from 'react';
import { Splash } from './ui/Splash';

const GameScreen = lazy(() => import('./GameScreen'));

export function App() {
  return (
    <>
      <Suspense fallback={null}>
        <GameScreen />
      </Suspense>
      <Splash />
    </>
  );
}
