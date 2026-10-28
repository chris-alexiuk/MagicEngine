import type { Color, CostModifierNode, FaceDef, StaticAbility } from '@mtg/schema';
import { matchesFilter, objectAbilities, printedAbilities } from './characteristics.js';
import { evalCondition } from './conditions.js';
import type { ManaCost } from './mana.js';
import type { EffectContext } from './registry.js';
import { amountOf } from './resolve.js';
import type { GameObject, GameState, ManaColor, PlayerId } from './types.js';
import type { TargetRef } from './types.js';
import { faceOf, abilitySources } from './zones.js';

/**
 * CR 601.2f: the total cost of a spell is its mana cost (or an alternative cost), plus additional
 * costs and cost increases, minus cost reductions. This applies the increases and reductions
 * from the spell itself ("This spell costs {1} less to cast for each artifact you control") and
 * from permanents ("Creature spells you cast cost {1} less to cast").
 */
/** `targets`: the spell's chosen targets, for "costs {2} less to cast if it targets a tapped creature". */
export function applyCostModifiers(g: GameState, player: PlayerId, spell: GameObject, face: FaceDef, cost: ManaCost, targets?: TargetRef[][]): void {
  const changes: { n: number; color?: Color; change: 'less' | 'more' }[] = [];
  const ctxFor = (controller: PlayerId, source: GameObject): EffectContext => ({ g, controller, source, events: [], targets: [], x: 0, memo: {} });

  // CR 113.6e: the spell's own ability works wherever it's cast from (including keywords like affinity, CR 702.41a).
  for (const a of printedAbilities(face)) {
    if (a.kind !== 'static' || a.effect.type !== 'cost_modifier') continue;
    const e = a.effect as CostModifierNode;
    if (!e.self) continue;
    const ctx = ctxFor(player, spell);
    if (e.condition && !evalCondition(e.condition, ctx)) continue;
    if (e.ifTargets) {
      const hit = (targets ?? []).flat().some((t) => {
        if (t.kind !== 'object') return false;
        const o = g.objects[t.id];
        return Boolean(o && o.zcc === t.zcc && matchesFilter(g, o, e.ifTargets!, { controller: player, source: spell, anyZone: true }));
      });
      if (!hit) continue;
    }
    changes.push({ n: amountOf(ctx, e.amount), ...(e.color ? { color: e.color } : {}), change: e.change });
  }
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'cost_modifier') continue;
      const e = (a as StaticAbility).effect as CostModifierNode;
      if (e.self) continue;
      const whose = e.who ?? 'each';
      if (whose === 'you' ? player !== source.controller : whose === 'opponents' ? player === source.controller : false) continue;
      const ctx = ctxFor(source.controller, source);
      if (e.filter && !matchesFilter(g, spell, e.filter, { controller: source.controller, source, anyZone: true })) continue;
      // As its cost is worked out, the spell is still where it's cast from (it moves to the stack after, CR 601.2a's order here).
      if (e.castFrom && !e.castFrom.includes(spell.zone as 'graveyard' | 'exile')) continue;
      if (e.notFromHand && spell.zone === 'hand') continue;
      if (e.condition && !evalCondition(e.condition, ctx)) continue;
      changes.push({ n: amountOf(ctx, e.amount), ...(e.color ? { color: e.color } : {}), change: e.change });
    }
  }

  // "The next spell you cast this turn costs {1} less to cast."
  for (const n of g.nextSpell ?? []) {
    if (n.player !== player || n.turn !== g.turn || !n.reduce) continue;
    if (!matchesFilter(g, spell, n.filter, { controller: player, source: g.objects[n.source.id] ?? null, anyZone: true })) continue;
    changes.push({ n: n.reduce, change: 'less' });
  }
  // Increases first, then reductions; generic mana can't go below zero (CR 601.2f).
  for (const c of changes) {
    if (c.change !== 'more' || c.n <= 0) continue;
    if (c.color) cost.specific[c.color as ManaColor] = (cost.specific[c.color as ManaColor] ?? 0) + c.n;
    else cost.generic += c.n;
  }
  for (const c of changes) {
    if (c.change !== 'less' || c.n <= 0) continue;
    let n = c.n;
    if (c.color) {
      // A colored reduction takes that color off first, and generic mana with what's left.
      const have = cost.specific[c.color as ManaColor] ?? 0;
      const off = Math.min(have, n);
      cost.specific[c.color as ManaColor] = have - off;
      n -= off;
    }
    cost.generic = Math.max(0, cost.generic - n);
  }
}
