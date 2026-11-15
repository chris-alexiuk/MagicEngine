import { DURATIONS, type Duration } from '@mtg/schema';
import type { ContinuousEffect, GameObject, GameState, PlayerId } from './types.js';
import { nextPlayer } from './zones.js';

/**
 * How long an effect lasts (CR 611.2a–b; the durations are listed in the schema, durations.ts), ended in one place for
 * every effect that has a duration. An effect that sits in `g.effects` ends by the fields `lasting` gives it; one kept
 * by turn number (a rule for a player, a ban on casting) by `lastTurnFor`. A node with no `until` lasts as its kind of
 * effect does by default.
 */

/** The turn `player`'s next turn is (extra turns aside), or this one for 'eot'. */
export function lastTurnOf(g: GameState, player: PlayerId, until: 'eot' | 'next_turn'): number {
  if (until === 'eot') return g.turn;
  // The player's next turn: count turns in order from the next one (extra turns aside).
  let turn = g.turn + 1;
  let p = nextPlayer(g, g.active);
  for (let i = 0; i < g.order.length && p !== player; i++) {
    p = nextPlayer(g, p);
    turn++;
  }
  return turn;
}

/** For an effect kept by turn number: the last turn it applies in. */
export function lastTurnFor(until: unknown, g: GameState, controller: PlayerId): number {
  if (until === 'your_next_turn') return lastTurnOf(g, controller, 'next_turn') - 1;
  if (until === 'end_of_your_next_turn') return lastTurnOf(g, controller, 'next_turn');
  if (until === 'game') return Number.MAX_SAFE_INTEGER;
  return g.turn;
}

type Lasting = Pick<ContinuousEffect, 'until' | 'endOfCombat' | 'whileTapped' | 'whilePresent' | 'whileCounter' | 'untilTurnOf' | 'throughTurn'>;

/** What a node says of how long its effect lasts: a duration, and "for as long as it has a [kind] counter on it". */
type Said = { readonly [param: string]: unknown };

/**
 * For a continuous effect: what ends it. `otherwise` is how long the effect lasts when the node states no duration
 * (a pump lasts the turn; control gained lasts).
 */
export function lasting(node: Said, g: GameState, controller: PlayerId, source: GameObject | null | undefined, otherwise: 'eot' | 'game'): Lasting {
  const d = (DURATIONS as readonly unknown[]).includes(node.until) ? (node.until as Duration) : otherwise;
  const src = source ? { id: source.id, zcc: source.zcc } : undefined;
  const yours = d === 'source_controlled' || d === 'source_controlled_tapped';
  return {
    // CR 611.2a: "until end of turn" ends in the cleanup step (CR 514.2); the rest end by what is named below.
    until: d === 'eot' || d === 'eoc' ? 'eot' : 'game',
    ...(d === 'eoc' ? { endOfCombat: true as const } : {}),
    // CR 611.2b: "for as long as ~ remains tapped"; Rubinia Soulsinger: "… you control ~ and ~ remains tapped" — both.
    ...((d === 'source_tapped' || d === 'source_controlled_tapped') && src ? { whileTapped: src } : {}),
    // Aegis Angel: "for as long as you control this creature"; Skilled Animator: "… remains on the battlefield".
    ...(yours && src ? { whilePresent: { ...src, player: controller } } : {}),
    ...(d === 'source_present' && src ? { whilePresent: src } : {}),
    ...(d === 'your_next_turn' ? { untilTurnOf: controller } : {}),
    // Treasure Nabber: "until the end of your next turn" — it ends with that turn's cleanup (CR 514.2).
    ...(d === 'end_of_your_next_turn' ? { throughTurn: lastTurnOf(g, controller, 'next_turn') } : {}),
    // Shield Broker: "for as long as it has a shield counter on it" — each thing it affects, while that one has one.
    ...(typeof node.whileCounter === 'string' ? { whileCounter: node.whileCounter } : {}),
  };
}

/**
 * CR 611.2b: a "for as long as" duration that has already ended as the effect would begin — its source gone, no longer
 * yours, or untapped — and the effect does nothing.
 */
export function neverStarts(node: Said, controller: PlayerId, source: GameObject | null | undefined, sourceZcc?: number): boolean {
  const d = node.until;
  if (d !== 'source_tapped' && d !== 'source_controlled' && d !== 'source_present' && d !== 'source_controlled_tapped') return false;
  if (!source || source.zone !== 'battlefield' || (sourceZcc !== undefined && source.zcc !== sourceZcc)) return true;
  if ((d === 'source_controlled' || d === 'source_controlled_tapped') && source.controller !== controller) return true;
  return (d === 'source_tapped' || d === 'source_controlled_tapped') && !source.tapped;
}
