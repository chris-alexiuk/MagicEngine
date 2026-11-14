import type { Action } from '@mtg/engine';

/**
 * What clicking a card does, like a digital client: with exactly one thing to do, it does it (casting with autotap,
 * playing a land, tapping a land for its one colour); with several, a small menu opens at the card.
 *
 * `own`: for a permanent the player controls, how many activated abilities it has. With more than one, the menu always
 * opens — each ability is shown, usable now or not — so a click never picks for the player the one ability that happens
 * to be payable. A permanent whose abilities can't be used right now opens it too, to say why (unless all it does is
 * make mana: a tapped land stays quiet).
 */
export function clickOutcome(listed: readonly Action[], extra: readonly Action[], own: { abilities: number; nonMana: number } = { abilities: 0, nonMana: 0 }): { kind: 'act'; action: Action } | { kind: 'menu' } | { kind: 'none' } {
  const all = [...listed, ...extra];
  if (!all.length) return own.nonMana > 0 ? { kind: 'menu' } : { kind: 'none' };
  if (own.abilities > 1) return { kind: 'menu' };
  // A spell or ability with X always asks for the number (those come in `extra`, one for each X).
  const asksX = (a: Action) => (a.type === 'cast' || a.type === 'activate') && a.x !== undefined;
  if (all.length === 1 && !(all[0]!.type === 'cast' && all[0]!.x !== undefined) && !extra.some(asksX)) return { kind: 'act', action: all[0]! };
  return { kind: 'menu' };
}

/** What dragging a hand card onto the battlefield does: play it as a land, or cast it (the first way listed). */
export function dragAction(listed: readonly Action[]): Action | null {
  return listed.find((a) => a.type === 'play_land') ?? listed.find((a) => a.type === 'cast') ?? null;
}
