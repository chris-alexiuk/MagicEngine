import type { ContinuousEffectNode, PlayerRule, PlayerRuleNode, StaticAbility } from '@mtg/schema';
import { matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import type { GameObject, GameState, PlayerId } from './types.js';
import { faceOf, abilitySources } from './zones.js';

/**
 * Static abilities that change the rules for players rather than objects:
 * "You have no maximum hand size" (CR 402.2), "You may play an additional land on each
 * of your turns" (CR 305.2), "Skip your draw step" (CR 614.10).
 * Returns how many apply to `player` (for extra lands, the total number of extra lands).
 */
/**
 * CR 702.8a: whether this player may cast this card as though it had flash — "You may cast spells as though they had
 * flash", or only some ("You may cast Aura and Equipment spells as though they had flash", Sigarda's Aid).
 */
export function flashPermission(g: GameState, player: PlayerId, card: GameObject): boolean {
  for (const e of g.playerEffects ?? []) {
    if (e.player !== player || e.rule !== 'flash' || e.lastTurn < g.turn) continue;
    if (!e.filter || matchesFilter(g, card, e.filter, { controller: player, anyZone: true })) return true;
  }
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'flash') continue;
      const applies = e.who === 'each' || (e.who === 'you' ? player === source.controller : player !== source.controller);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      if (!e.filter || matchesFilter(g, card, e.filter, { controller: player, source, anyZone: true })) return true;
    }
  }
  return false;
}

export function playerRule(g: GameState, player: PlayerId, rule: PlayerRule): number {
  let n = 0;
  // "Until your next turn, … you gain protection from everything" — from an effect, not a static ability.
  for (const e of g.playerEffects ?? []) if (e.player === player && e.rule === rule && e.lastTurn >= g.turn && !e.filter) n++;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      // Shalai: "You, planeswalkers you control, and other creatures you control have hexproof."
      if (a.kind === 'static' && a.effect.type === 'continuous') {
        const c = a.effect as ContinuousEffectNode;
        if (c.alsoPlayer === rule && player === source.controller && staticConditionHolds(g, c, source)) n++;
        continue;
      }
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      // A rule for some spells only ("Aura and Equipment spells … flash") is checked per spell (flashPermission).
      if (e.rule !== rule || e.filter) continue;
      const applies = e.who === 'each' || (e.who === 'you' ? player === source.controller : player !== source.controller);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      n += e.amount ?? 1;
    }
  }
  return n;
}

/** CR 305.2: one land a turn, plus any extra land plays. */
export function landsAllowed(g: GameState, player: PlayerId): number {
  const extra = g.players[player]?.extraLands;
  return 1 + playerRule(g, player, 'extra_lands') + (extra?.turn === g.turn ? extra.n : 0);
}
