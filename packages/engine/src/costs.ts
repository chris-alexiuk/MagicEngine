import type { Color, CostModifierNode, FaceDef, ObjectFilter, StaticAbility } from '@mtg/schema';
import { matchesFilter, objectAbilities, printedAbilities } from './characteristics.js';
import { evalCondition } from './conditions.js';
import type { ManaCost } from './mana.js';
import type { EffectContext } from './registry.js';
import { amountOf } from './resolve.js';
import type { GameObject, GameState, ManaColor, PlayerId } from './types.js';
import type { TargetRef } from './types.js';
import { faceOf, abilitySources } from './zones.js';

/** "… if it targets a tapped creature": one of the chosen targets is like that. */
function targetsMatch(g: GameState, targets: TargetRef[][] | undefined, filter: ObjectFilter, controller: PlayerId, source: GameObject): boolean {
  return (targets ?? []).flat().some((t) => {
    if (t.kind !== 'object') return false;
    const o = g.objects[t.id];
    // "that target a creature": a creature permanent, not a creature card elsewhere (a filter that names a zone checks that one).
    return Boolean(o && o.zcc === t.zcc && matchesFilter(g, o, filter, { controller, source }));
  });
}

/**
 * CR 601.2f: the total cost of a spell is its mana cost (or an alternative cost), plus additional
 * costs and cost increases, minus cost reductions. This applies the increases and reductions
 * from the spell itself ("This spell costs {1} less to cast for each artifact you control") and
 * from permanents ("Creature spells you cast cost {1} less to cast").
 */
/** `targets`: the spell's chosen targets, for "costs {2} less to cast if it targets a tapped creature". */
export function applyCostModifiers(g: GameState, player: PlayerId, spell: GameObject, face: FaceDef, cost: ManaCost, targets?: TargetRef[][]): void {
  const changes: { n: number; color?: Color; change: 'less' | 'more'; coloredOnly?: true }[] = [];
  const ctxFor = (controller: PlayerId, source: GameObject): EffectContext => ({ g, controller, source, events: [], targets: [], x: 0, memo: {} });

  // CR 113.6e: the spell's own ability works wherever it's cast from (including keywords like affinity, CR 702.41a).
  for (const a of printedAbilities(face)) {
    if (a.kind !== 'static' || a.effect.type !== 'cost_modifier') continue;
    const e = a.effect as CostModifierNode;
    // Torgaar: "for each creature sacrificed this way" — counted from the cost choices as it's cast (see cast()).
    if (!e.self || e.perSacrificed || e.perExiled) continue;
    const ctx = ctxFor(player, spell);
    if (e.condition && !evalCondition(e.condition, ctx)) continue;
    if (e.ifTargets && !targetsMatch(g, targets, e.ifTargets, player, spell)) continue;
    for (const color of e.colors ?? [e.color]) changes.push({ n: amountOf(ctx, e.amount), ...(color ? { color } : {}), change: e.change, ...(e.coloredOnly ? { coloredOnly: true } : {}) });
    if (e.generic) changes.push({ n: e.generic, change: e.change });
  }
  // Eminence (The Ur-Dragon): a card in the command zone whose cost reduction works from there too.
  const eminent = g.zones.command.filter((id) => {
    const o = g.objects[id];
    return o && !o.emblem && printedAbilities(faceOf(g, o)).some((a) => a.kind === 'static' && (a.effect as CostModifierNode).eminence);
  });
  for (const id of eminent.length ? [...abilitySources(g), ...eminent] : abilitySources(g)) {
    const source = g.objects[id]!;
    const inCommand = source.zone === 'command' && !source.emblem;
    for (const a of inCommand ? printedAbilities(faceOf(g, source)) : objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'cost_modifier') continue;
      const e = (a as StaticAbility).effect as CostModifierNode;
      if (e.self || (inCommand && !e.eminence)) continue;
      const whose = e.who ?? 'each';
      if (whose === 'you' ? player !== source.controller : whose === 'opponents' ? player === source.controller : false) continue;
      const ctx = ctxFor(source.controller, source);
      if (e.filter && !matchesFilter(g, spell, e.filter, { controller: source.controller, source, anyZone: true })) continue;
      // As its cost is worked out, the spell is still where it's cast from (it moves to the stack after, CR 601.2a's order here).
      if (e.castFrom && !e.castFrom.includes(spell.zone as 'graveyard' | 'exile')) continue;
      if (e.notFromHand && spell.zone === 'hand') continue;
      // Defense Grid: "except during its controller's turn".
      if (e.exceptCastersTurn && g.active === player) continue;
      // Conduit of Ruin: "The first creature spell you cast each turn" — none like it cast before this one this turn.
      if (e.firstEachTurn) {
        const before = (g.turnLog.castSpells ?? []).filter((c) => c.player === player && c.id !== spell.id && g.objects[c.id] && (!e.filter || matchesFilter(g, g.objects[c.id]!, e.filter, { controller: source.controller, source, anyZone: true })));
        // Alisaie Leveilleur: "The second spell you cast each turn" — exactly one cast before it.
        if (before.length !== (e.nthEachTurn ?? 1) - 1) continue;
      }
      if (e.condition && !evalCondition(e.condition, ctx)) continue;
      // Killian: "Spells you cast that target a creature cost {2} less to cast."
      const targetsYou = Boolean(e.ifTargetsYou && (targets ?? []).flat().some((t) => t.kind === 'player' && t.player === source.controller));
      if (e.ifTargets && !targetsYou && !targetsMatch(g, targets, e.ifTargets, source.controller, source)) continue;
      for (const color of e.colors ?? [e.color]) changes.push({ n: amountOf(ctx, e.amount), ...(color ? { color } : {}), change: e.change, ...(e.coloredOnly ? { coloredOnly: true } : {}) });
      if (e.generic) changes.push({ n: e.generic, change: e.change });
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
      // Morophon: "reduces only the amount of colored mana you pay" — a Phyrexian symbol of that color too (CR 107.4f).
      for (let i = cost.phyrexian.length - 1; i >= 0 && n > 0 && c.coloredOnly; i--) {
        if (cost.phyrexian[i]!.includes(c.color as ManaColor)) {
          cost.phyrexian = cost.phyrexian.filter((_, j) => j !== i);
          n--;
        }
      }
      if (c.coloredOnly) continue;
    }
    cost.generic = Math.max(0, cost.generic - n);
  }
}
