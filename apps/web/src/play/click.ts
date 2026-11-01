import type { Action } from '@mtg/engine';

/**
 * What clicking a card does, like a digital client: with exactly one thing to do, it does it (casting with autotap,
 * playing a land, tapping a land for its one colour); with several, a small menu opens at the card.
 */
export function clickOutcome(listed: readonly Action[], extra: readonly Action[]): { kind: 'act'; action: Action } | { kind: 'menu' } | { kind: 'none' } {
  const all = [...listed, ...extra];
  if (!all.length) return { kind: 'none' };
  // A spell with X always asks for the number.
  if (all.length === 1 && !(all[0]!.type === 'cast' && all[0]!.x !== undefined)) return { kind: 'act', action: all[0]! };
  return { kind: 'menu' };
}

/** What dragging a hand card onto the battlefield does: play it as a land, or cast it (the first way listed). */
export function dragAction(listed: readonly Action[]): Action | null {
  return listed.find((a) => a.type === 'play_land') ?? listed.find((a) => a.type === 'cast') ?? null;
}
