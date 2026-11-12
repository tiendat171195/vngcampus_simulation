import { healthResponseSchema } from '@campus/shared';
import { Client } from '@colyseus/sdk';
import { useEffect, useState } from 'react';

export type ServiceState = 'pending' | 'ok' | 'error';

export interface ServiceStatus {
  api: ServiceState;
  realtime: ServiceState;
  /** Clients connected to the placeholder room, including this one. */
  visitors: number | null;
}

/** Checks the REST API and joins the placeholder realtime room, both through the page's origin. */
export function useServiceStatus(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>({
    api: 'pending',
    realtime: 'pending',
    visitors: null,
  });

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/health', { signal: abort.signal })
      .then((response) => response.json())
      .then((body) => {
        healthResponseSchema.parse(body);
        setStatus((current) => ({ ...current, api: 'ok' }));
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus((current) => ({ ...current, api: 'error' }));
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const client = new Client(`${window.location.origin}/rt`);
    const joining = client.joinOrCreate<{ visitors: number }>('hello');

    joining
      .then((room) => {
        if (cancelled) return;
        const sync = (state: { visitors: number }) => {
          setStatus((current) => ({ ...current, realtime: 'ok', visitors: state.visitors }));
        };
        room.onStateChange(sync);
        room.onLeave(() => {
          if (!cancelled) setStatus((c) => ({ ...c, realtime: 'error', visitors: null }));
        });
      })
      .catch(() => {
        if (!cancelled) setStatus((current) => ({ ...current, realtime: 'error' }));
      });

    return () => {
      cancelled = true;
      joining.then((room) => room.leave()).catch(() => {});
    };
  }, []);

  return status;
}
