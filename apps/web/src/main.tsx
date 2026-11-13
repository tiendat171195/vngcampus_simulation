import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Developer pages are loaded on demand so they never weigh on the game bundle.
const MapDebugPage = lazy(() => import('./debug/MapDebugPage'));

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

const isMapDebug = window.location.pathname.startsWith('/debug/map');

createRoot(root).render(
  <StrictMode>
    {isMapDebug ? (
      <Suspense fallback={null}>
        <MapDebugPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
