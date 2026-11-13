import type { ObjectiveHandler } from '../types';

interface SocialState {
  /** Colleagues already greeted; each counts once. */
  greeted: string[];
}

/** Do an emote towards N different colleagues (docs/06 §4). */
export const socialHandler: ObjectiveHandler<'social', SocialState> = {
  type: 'social',
  events: ['emote.performed'],
  init: () => ({ greeted: [] }),
  onEvent(_ctx, objective, state, event, player) {
    if (event.type !== 'emote.performed' || event.emote !== objective.params.emote) return null;
    const fresh = event.nearbyUserIds.filter(
      (id) => id !== player.userId && !state.greeted.includes(id),
    );
    if (fresh.length === 0) return null;
    const greeted = [...state.greeted, ...new Set(fresh)];
    return { state: { greeted }, current: Math.min(objective.target, greeted.length) };
  },
  clientView: (objective, state) => ({
    emote: objective.params.emote,
    greeted: state.greeted.length,
  }),
};
