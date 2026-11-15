import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Developer pages are loaded on demand so they never weigh on the game bundle.
const MapDebugPage = lazy(() => import('./debug/MapDebugPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

const path = window.location.pathname;
const Page = path.startsWith('/debug/map')
  ? MapDebugPage
  : path.startsWith('/privacy')
    ? PrivacyPage
    : path.startsWith('/terms')
      ? TermsPage
      : null;

// Production builds keep hashed files in a service worker cache (public/sw.js), so coming back
// the next day starts almost at once; development never registers it.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('[campus] service worker not registered', error);
    });
  });

createRoot(root).render(
  <StrictMode>
    {Page ? (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
