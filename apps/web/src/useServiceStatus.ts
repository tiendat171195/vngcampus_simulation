import { type ChannelInfo, healthResponseSchema } from '@campus/shared';
import { useEffect, useState } from 'react';

export type ServiceState = 'pending' | 'ok' | 'error';

export interface ServiceStatus {
  api: ServiceState;
  realtime: ServiceState;
  /** Players across all channels, from the realtime server's channel list. */
  visitors: number | null;
}

const REFRESH_MS = 5000;

/** Polls the REST API and the realtime server through the page's own origin. */
export function useServiceStatus(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>({
    api: 'pending',
    realtime: 'pending',
    visitors: null,
  });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const api = await fetch('/api/health')
        .then((r) => r.json())
        .then((body) => (healthResponseSchema.safeParse(body).success ? 'ok' : 'error'))
        .catch(() => 'error' as const);
      const channels = await fetch('/rt/channels')
        .then((r) => (r.ok ? (r.json() as Promise<ChannelInfo[]>) : null))
        .catch(() => null);
      if (cancelled) return;
      setStatus({
        api: api as ServiceState,
        realtime: channels ? 'ok' : 'error',
        visitors: channels ? channels.reduce((sum, channel) => sum + channel.players, 0) : null,
      });
    };
    void check();
    const timer = window.setInterval(check, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return status;
}
