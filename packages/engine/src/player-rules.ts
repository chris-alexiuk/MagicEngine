import type { PlayerRule, PlayerRuleNode, StaticAbility } from '@mtg/schema';
import { objectAbilities, staticConditionHolds } from './characteristics.js';
import type { GameState, PlayerId } from './types.js';
import { faceOf, abilitySources } from './zones.js';

/**
 * Static abilities that change the rules for players rather than objects:
 * "You have no maximum hand size" (CR 402.2), "You may play an additional land on each
 * of your turns" (CR 305.2), "Skip your draw step" (CR 614.10).
 * Returns how many apply to `player` (for extra lands, the total number of extra lands).
 */
export function playerRule(g: GameState, player: PlayerId, rule: PlayerRule): number {
  let n = 0;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== rule) continue;
      const applies = e.who === 'each' || (e.who === 'you' ? player === source.controller : player !== source.controller);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      n += e.amount ?? 1;
    }
  }
  return n;
}

/** CR 305.2: one land a turn, plus any extra land plays. */
export function landsAllowed(g: GameState, player: PlayerId): number {
  return 1 + playerRule(g, player, 'extra_lands');
}
