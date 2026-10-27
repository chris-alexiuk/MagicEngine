import type { TriggeredAbility } from '@mtg/schema';
import type { GameObject, GameState } from './types.js';

/**
 * CR 701.54c: the emblem named The Ring. Its first ability ("Your Ring-bearer is legendary and can't be blocked by
 * creatures with greater power") is applied in characteristics and in blocking; these are the triggered ones it
 * gains as the Ring tempts its owner a second, third and fourth time. They trigger from the Ring-bearer.
 */
const RING_TRIGGERS: TriggeredAbility[] = [
  {
    kind: 'triggered',
    text: 'The Ring — whenever your Ring-bearer attacks, draw a card, then discard a card.',
    trigger: { type: 'attacks', subject: { ref: 'self' } },
    effects: [{ type: 'draw', amount: 1, who: { ref: 'you' } }, { type: 'discard', amount: 1, who: { ref: 'you' } }],
  },
  {
    kind: 'triggered',
    text: 'The Ring — whenever your Ring-bearer becomes blocked by a creature, that creature’s controller sacrifices it at end of combat.',
    trigger: { type: 'becomes_blocked', subject: { ref: 'self' }, by: {} },
    effects: [{ type: 'delayed', step: 'end_of_combat', effects: [{ type: 'sacrifice', what: { ref: 'trigger_object' }, byController: true }] }],
  },
  {
    kind: 'triggered',
    text: 'The Ring — whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.',
    trigger: { type: 'deals_combat_damage', subject: { ref: 'self' }, to: 'player' },
    effects: [{ type: 'lose_life', amount: 3, who: { ref: 'players', who: 'opponents' } }],
  },
];

/** CR 701.54e: on the battlefield under that player's control, with the designation. */
export function isRingBearer(o: GameObject): boolean {
  return o.zone === 'battlefield' && o.ringBearer !== undefined && o.ringBearer === o.controller;
}

/** The Ring's triggered abilities that work through this creature, as its controller's Ring-bearer. */
export function ringAbilities(g: GameState, o: GameObject): TriggeredAbility[] {
  if (!isRingBearer(o)) return [];
  const times = g.players[o.controller]?.ringTempted ?? 0;
  return RING_TRIGGERS.slice(0, Math.max(0, times - 1));
}
