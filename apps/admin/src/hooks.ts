import { useCallback, useEffect, useState } from 'react';

/** Loads something once (and again on `reload`), with its error. A small stand-in for a query library. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then(
      (result) => live && setData(result),
      (failure: Error) => live && setError(failure.message),
    );
    return () => {
      live = false;
    };
  }, [...deps, version]);
  return { data, error, reload };
}

/** The current path, kept in step with the address bar; `go` moves without reloading. */
export function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: string) => {
    window.history.pushState(null, '', next);
    setPath(next);
  }, []);
  return [path, go];
}

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'short',
});
export const when = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');
