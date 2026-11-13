/** A sanction in force, as the realtime server needs it. */
export interface ActiveSanction {
  id?: string;
  userId: string;
  type: 'mute' | 'ban' | 'warn';
  endsAt: Date | null;
  reason?: string;
}

const clock = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
});

/**
 * Mutes and bans, reloaded every few seconds from the database (docs/08 §6: in force within
 * seconds, no Redis needed yet). Rooms ask it before relaying chat and are told when someone is
 * banned so they can be shown out.
 */
export class SanctionWatcher {
  private mutes = new Map<string, Date | null>();
  private bans = new Set<string>();
  private warnings = new Map<string, Array<{ id: string; reason: string }>>();
  /** Warnings already shown, so each is shown once per process. */
  private readonly delivered = new Set<string>();
  private readonly listeners = new Set<(banned: ReadonlySet<string>) => void>();
  private readonly warningListeners = new Set<() => void>();
  private readonly load: () => Promise<ActiveSanction[]>;

  constructor(load: () => Promise<ActiveSanction[]>) {
    this.load = load;
  }

  async refresh(): Promise<void> {
    try {
      const active = await this.load();
      const mutes = new Map<string, Date | null>();
      const bans = new Set<string>();
      const warnings = new Map<string, Array<{ id: string; reason: string }>>();
      for (const sanction of active) {
        if (sanction.type === 'ban') bans.add(sanction.userId);
        else if (sanction.type === 'warn') {
          const id = sanction.id ?? `${sanction.userId}:${sanction.reason ?? ''}`;
          if (this.delivered.has(id)) continue;
          warnings.set(sanction.userId, [
            ...(warnings.get(sanction.userId) ?? []),
            { id, reason: sanction.reason ?? '' },
          ]);
        } else {
          const previous = mutes.get(sanction.userId);
          // The longest mute wins; null means until lifted.
          if (
            previous === undefined ||
            (previous !== null && (sanction.endsAt === null || sanction.endsAt > previous))
          )
            mutes.set(sanction.userId, sanction.endsAt);
        }
      }
      this.mutes = mutes;
      this.bans = bans;
      this.warnings = warnings;
      if (bans.size > 0) for (const listener of this.listeners) listener(bans);
      if (warnings.size > 0) for (const listener of this.warningListeners) listener();
    } catch (error) {
      console.warn(`[moderation] sanctions not refreshed: ${String(error)}`);
    }
  }

  start(intervalMs = 5000): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  isBanned(userId: string): boolean {
    return this.bans.has(userId);
  }

  /** Why this person may not chat right now, or null when they may. */
  muteNotice(userId: string, now = new Date()): string | null {
    if (!this.mutes.has(userId)) return null;
    const until = this.mutes.get(userId) ?? null;
    if (until && until <= now) return null;
    return until
      ? `Bạn đang bị tạm khoá chat đến ${clock.format(until)}.`
      : 'Bạn đang bị khoá chat.';
  }

  /** Warnings for this person not shown yet; they count as shown from now on. */
  takeWarnings(userId: string): string[] {
    const pending = this.warnings.get(userId);
    if (!pending) return [];
    this.warnings.delete(userId);
    for (const warning of pending) this.delivered.add(warning.id);
    return pending.map((warning) =>
      warning.reason
        ? `Kiểm duyệt viên nhắc bạn: ${warning.reason}. Hãy giữ campus thân thiện nhé.`
        : 'Kiểm duyệt viên nhắc bạn giữ campus thân thiện nhé.',
    );
  }

  /** Called after each refresh that found warnings not shown yet. */
  onWarnings(listener: () => void): () => void {
    this.warningListeners.add(listener);
    return () => this.warningListeners.delete(listener);
  }

  /** Called with everyone banned, after each refresh that found any. */
  onBans(listener: (banned: ReadonlySet<string>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
