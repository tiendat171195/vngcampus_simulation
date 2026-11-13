import type { OpsMessage } from '@campus/shared';

export const NO_OPS: OpsMessage = { chatEnabled: true, maintenance: null, announcements: [] };

/**
 * Kill switches, maintenance and announcements (docs/08 §5), reloaded every few seconds from the
 * database like sanctions: in force within seconds, no Redis needed with one realtime process.
 * Rooms read `current` and are told when it changes so they can tell everyone inside.
 */
export class OpsWatcher {
  private view: OpsMessage = NO_OPS;
  private key = JSON.stringify(NO_OPS);
  private readonly listeners = new Set<(view: OpsMessage) => void>();
  private readonly load: () => Promise<OpsMessage>;

  constructor(load: () => Promise<OpsMessage>) {
    this.load = load;
  }

  get current(): OpsMessage {
    return this.view;
  }

  async refresh(): Promise<void> {
    let next: OpsMessage;
    try {
      next = await this.load();
    } catch (error) {
      // Keep the last known state: a database hiccup must not switch chat back on.
      console.warn(`[ops] settings not refreshed: ${String(error)}`);
      return;
    }
    const key = JSON.stringify(next);
    if (key === this.key) return;
    this.view = next;
    this.key = key;
    for (const listener of this.listeners) listener(next);
  }

  start(intervalMs = 5000): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  onChange(listener: (view: OpsMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
