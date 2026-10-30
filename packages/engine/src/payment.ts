import { activationProhibited } from './cast-bans.js';
import { evalCondition } from './conditions.js';
import { playerRule } from './player-rules.js';
import type { AddManaEffect, Amount, ConditionNode, Cost, EffectNode, ObjectFilter, Ref, TriggeredAbility } from '@mtg/schema';
import { amountOf } from './resolve.js';
import { planManaOnly } from './autotap.js';
import { canActivateTapAbilities, hasRule, hasType, lkiStats, manaAbilities, manaMultiplier, matchesFilter, objectAbilities, power, toughness } from './characteristics.js';
import { anyColorChoices, parseManaCost, payFromPool, type ManaCost } from './mana.js';
import { OTHER_PURPOSE, payMana, spendablePool, type ManaPurpose } from './spending.js';
import { runEffect } from './registry.js';
import { RulesError, type CostChoices, type CostLKI, type GameEvent, type GameObject, type GameState, type ManaColor, type ManaMix, type ObjectId, type PlayerId } from './types.js';
import { abilitySources, discardCard, manaValueOf, moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';
import { cantLoseLife, lifeLoss, replaceQuantity } from './quantities.js';

/** Paying costs: mana abilities, automatic tapping, and non-mana costs (CR 118, CR 605). */

/** Non-mana cost tags the engine can pay. */
export const COST_TYPES: readonly string[] = ['exert_self', 'sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards', 'remove_counters_self', 'station', 'return_unblocked', 'tap_creatures', 'craft', 'collect_evidence', 'return_permanents', 'reveal_from_hand', 'behold', 'blight', 'forage', 'exile_self_hand', 'discard_hand', 'exile_self_battlefield', 'put_counters_self', 'mill', 'return_self', 'remove_counters', 'process'];

/** Permanents a player could sacrifice for a "Sacrifice a creature" cost. */
export function sacrificeCandidates(g: GameState, player: PlayerId, c: EffectNode, source: GameObject): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  return g.zones.battlefield.filter((id) => {
    const p = g.objects[id]!;
    return p.controller === player && matchesFilter(g, p, filter, { controller: player, source });
  });
}

/** CR 702.122a: creatures that could crew a Vehicle. */
/** CR 509.1h: attacking creatures you control that weren't blocked, once blockers have been declared. */
export function unblockedAttackers(g: GameState, player: PlayerId): ObjectId[] {
  const c = g.combat;
  if (!c || !c.attackersDeclared || c.toDeclareBlockers.length || !['declare_blockers', 'combat_damage', 'end_of_combat'].includes(g.step)) return [];
  return Object.entries(c.attackers).flatMap(([id, a]) => {
    const o = g.objects[id];
    return o && o.zone === 'battlefield' && o.zcc === a.zcc && o.controller === player && !a.blocked ? [id] : [];
  });
}

/** "Tap two untapped creatures you control that each share a color with it" (conspire), "Tap an untapped creature you control". */
export function tapCostCandidates(g: GameState, player: PlayerId, source: GameObject, c: EffectNode): ObjectId[] {
  return g.zones.battlefield.filter((id) => {
    const o = g.objects[id]!;
    return id !== source.id && o.controller === player && !o.tapped && matchesFilter(g, o, (c.filter ?? {}) as ObjectFilter, { controller: player, source });
  });
}

/** The power a creature crews or saddles with: Pilot tokens "as though its power were 2 greater". */
export function crewPower(g: GameState, o: GameObject): number {
  return power(g, o) + (hasRule(g, o, 'crews_plus_2') ? 2 : 0);
}

export function crewCandidates(g: GameState, player: PlayerId, vehicle: GameObject): ObjectId[] {
  return g.zones.battlefield.filter((id) => {
    const o = g.objects[id]!;
    return id !== vehicle.id && o.controller === player && !o.tapped && hasType(g, o, 'Creature');
  });
}

/** Cards a player could discard for a "Discard a card" cost (not the spell being cast). */
/** Cards in hand a discard cost could use ("Discard a land card": those matching its filter). */
export function discardCandidates(g: GameState, player: PlayerId, source: GameObject, filter?: ObjectFilter): ObjectId[] {
  return zoneList(g, 'hand', player).filter(
    (id) => id !== source.id && (!filter || matchesFilter(g, g.objects[id]!, { ...filter, zone: 'hand' }, { controller: player, source })),
  );
}

function checkChosen(chosen: ObjectId[] | undefined, candidates: ObjectId[], n: number, what: string): ObjectId[] {
  const list = chosen ?? [];
  if (list.length !== n || new Set(list).size !== n || !list.every((id) => candidates.includes(id))) {
    throw new RulesError(`Choose ${n} ${what} to pay the cost.`);
  }
  return list;
}

/** Non-mana costs (CR 118): checked before anything is paid, paid together with the rest (CR 601.2h). */
/** Other cards in your graveyard that could be exiled to pay a cost. */
/** CR 702.167a (craft): "Exile [materials] from among permanents you control and/or cards in your graveyard". */
export function craftCandidates(g: GameState, player: PlayerId, o: GameObject, c: EffectNode): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  const ctx = { controller: player, source: o, anyZone: true };
  return [
    ...zoneList(g, 'graveyard', player).filter((id) => matchesFilter(g, g.objects[id]!, { ...filter, zone: 'graveyard' }, ctx)),
    ...g.zones.battlefield.filter((id) => id !== o.id && g.objects[id]!.controller === player && matchesFilter(g, g.objects[id]!, filter, ctx)),
  ];
}

export function exileCostCandidates(g: GameState, player: PlayerId, o: GameObject, c?: EffectNode): ObjectId[] {
  const filter = c?.filter as ObjectFilter | undefined;
  // Food Chain: "Exile a creature you control".
  if (c?.from === 'battlefield') return g.zones.battlefield.filter((id) => g.objects[id]!.controller === player && (!filter || matchesFilter(g, g.objects[id]!, filter, { controller: player, source: o })));
  // "Exile a creature card from your graveyard"; "exile a blue card from your hand" (Force of Will).
  const zone = c?.from === 'hand' ? 'hand' : 'graveyard';
  return zoneList(g, zone, player).filter((id) => id !== o.id && (!filter || matchesFilter(g, g.objects[id]!, { ...filter, zone }, { controller: player, source: o })));
}

/**
 * "Reveal a Pirate card from your hand"; CR 701.4a: "behold a Dragon" — reveal a Dragon card from your hand or
 * choose a Dragon permanent you control.
 */
export function revealCostCandidates(g: GameState, player: PlayerId, o: GameObject, c: EffectNode): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  const ctx = { controller: player, source: o };
  const hand = zoneList(g, 'hand', player).filter((id) => id !== o.id && matchesFilter(g, g.objects[id]!, { ...filter, zone: 'hand' }, ctx));
  if (c.type !== 'behold') return hand;
  return [...hand, ...g.zones.battlefield.filter((id) => id !== o.id && g.objects[id]!.controller === player && matchesFilter(g, g.objects[id]!, filter, ctx))];
}

/** CR 701.68a: the creatures you control that could get the -1/-1 counters. */
export function blightCandidates(g: GameState, player: PlayerId): ObjectId[] {
  return g.zones.battlefield.filter((id) => g.objects[id]!.controller === player && hasType(g, g.objects[id]!, 'Creature'));
}

/** CR 701.61a: the Foods you could sacrifice to forage. */
export function foodCandidates(g: GameState, player: PlayerId): ObjectId[] {
  return g.zones.battlefield.filter((id) => g.objects[id]!.controller === player && matchesFilter(g, g.objects[id]!, { subtypes: ['Food'] }, { controller: player, source: null }));
}

/** CR 701.68a: "put N -1/-1 counters on a creature you control" (through replacement effects, CR 614.1a). */
export function blight(g: GameState, player: PlayerId, target: GameObject, n: number, events: GameEvent[]): void {
  const amount = replaceQuantity(g, 'counters', n, { player, object: target, counter: '-1/-1' });
  if (amount <= 0) return;
  target.counters['-1/-1'] = (target.counters['-1/-1'] ?? 0) + amount;
  events.push({ type: 'counters', object: target.id, counter: '-1/-1', delta: amount, by: player });
}

/** How much life a cost asks for: a number, or counted now ("Pay life equal to the number of colors in your commanders' color identity"). */
export function lifeCost(g: GameState, player: PlayerId, source: GameObject, c: EffectNode): number {
  if (typeof c.amount === 'number') return c.amount;
  if (c.amount && typeof c.amount === 'object') return amountOf({ g, controller: player, source, events: [], targets: [], x: 0, memo: {} }, c.amount as Amount);
  return Number(c.amount);
}

/**
 * Training Grounds, Zirda: "Activated abilities of creatures you control cost {2} less to activate. This effect can't
 * reduce the mana in that cost to less than one mana." (CR 601.2f, 118.7: generic mana only); Blossoming Tortoise:
 * "Activated abilities of lands you control cost {1} less to activate." — mana abilities too.
 */
export function abilityCostReductions(g: GameState, o: GameObject, ability: { cost: Cost; text?: string; mana?: boolean }, mana: ManaCost, player: PlayerId): void {
  if (ability.cost.loyalty !== undefined) return;
  for (const id of abilitySources(g)) {
    const src = g.objects[id]!;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'ability_cost_reduction') continue;
      // Zirda: "Abilities you activate that aren't mana abilities …"
      if (a.effect.byYou ? player !== src.controller : !matchesFilter(g, o, a.effect.filter as ObjectFilter, { controller: src.controller, source: src })) continue;
      if (a.effect.byYou && ability.mana) continue;
      // Fighter Class: "Equip abilities you activate …" (CR 702.6a).
      if (a.effect.equipOnly && !/^Equip\b/.test(ability.text ?? '')) continue;
      // Silver-Fur Master: "Ninjutsu abilities you activate …" (CR 702.49d: commander ninjutsu is one).
      // Fluctuator: "Cycling abilities you activate …" — typecycling is cycling (CR 702.29e).
      if (a.effect.cyclingOnly && !/^[A-Za-z ]*cycling\b/i.test(ability.text ?? '')) continue;
      if (a.effect.ninjutsuOnly && !/^(?:Commander )?[Nn]injutsu\b/.test(ability.text ?? '')) continue;
      const others = Object.values(mana.specific).reduce((s, v) => s + (v ?? 0), 0) + mana.hybrid.length + mana.phyrexian.length + mana.x;
      if (mana.generic + others === 0) continue;
      const floor = a.effect.minOne && others === 0 ? 1 : 0;
      mana.generic = Math.max(floor, mana.generic - Number(a.effect.amount ?? 0));
    }
  }
}

/** "Remove a counter from a nonland permanent you control" as a cost: permanents you control like that with such a counter. */
export function counterCostCandidates(g: GameState, player: PlayerId, o: GameObject, c: EffectNode): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  const kind = c.counter as string | undefined;
  return g.zones.battlefield.filter((id) => {
    const p = g.objects[id]!;
    return p.controller === player && matchesFilter(g, p, filter, { controller: player, source: o }) && Object.entries(p.counters).some(([k, n]) => (n ?? 0) > 0 && (!kind || k === kind));
  });
}

/** "Return an Island you control to its owner's hand" as a cost: permanents you control like that. */
export function returnCostCandidates(g: GameState, player: PlayerId, o: GameObject, c: EffectNode): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  return g.zones.battlefield.filter((id) => id !== o.id && g.objects[id]!.controller === player && matchesFilter(g, g.objects[id]!, filter, { controller: player, source: o }));
}

export function checkOtherCosts(g: GameState, player: PlayerId, o: GameObject, cost: Cost, choices: CostChoices = {}): void {
  // Two costs can't both use the same chosen object (Jarad: "Sacrifice a Swamp and a Forest" — two different lands).
  if (new Set(choices.sacrifice ?? []).size !== (choices.sacrifice ?? []).length) throw new RulesError('Choose a different permanent for each sacrifice.');
  if (new Set(choices.discard ?? []).size !== (choices.discard ?? []).length) throw new RulesError('Choose a different card for each discard.');
  let sacUsed = 0;
  let discardUsed = 0;
  for (const c of cost.other ?? []) {
    if (c.type === 'sacrifice') {
      const n = Number(c.amount ?? 1);
      checkChosen(choices.sacrifice?.slice(sacUsed, sacUsed + n), sacrificeCandidates(g, player, c, o), n, 'permanent(s) to sacrifice');
      sacUsed += n;
      continue;
    }
    if (c.type === 'discard') {
      const n = Number(c.amount ?? 1);
      checkChosen(choices.discard?.slice(discardUsed, discardUsed + n), discardCandidates(g, player, o, c.filter as ObjectFilter | undefined), n, 'card(s) to discard');
      discardUsed += n;
      continue;
    }
    if (c.type === 'sacrifice_self') {
      if (o.zone !== 'battlefield' || o.controller !== player) throw new RulesError(`You can’t sacrifice ${nameOf(g, o)}.`);
    } else if (c.type === 'exert_self') {
      // CR 701.43a: a permanent can be exerted even if it's exerted already.
      if (o.zone !== 'battlefield' || o.controller !== player) throw new RulesError(`You can’t exert ${nameOf(g, o)}.`);
    } else if (c.type === 'pay_life') {
      // CR 119.4: a player can pay life only if their life total is at least that much; CR 119.8: not if it can't change.
      const life = lifeCost(g, player, o, c);
      if (life > 0 && g.players[player]!.life < life) throw new RulesError(`You don’t have ${life} life to pay.`);
      if (life > 0 && playerRule(g, player, 'life_cant_change')) throw new RulesError('Your life total can’t change.');
      if (life > 0 && cantLoseLife(g, player)) throw new RulesError('You can’t lose life this turn, so you can’t pay life.');
    } else if (c.type === 'discard_self') {
      if (o.zone !== 'hand' || o.owner !== player) throw new RulesError(`${nameOf(g, o)} isn’t in your hand.`);
    } else if (c.type === 'exile_self') {
      if (o.zone !== 'graveyard' || o.owner !== player) throw new RulesError(`${nameOf(g, o)} isn’t in your graveyard.`);
    } else if (c.type === 'exile_self_hand') {
      if (o.zone !== 'hand' || o.owner !== player) throw new RulesError(`${nameOf(g, o)} isn’t in your hand.`);
    } else if (c.type === 'collect_evidence') {
      // CR 701.59a: exile cards from your graveyard with total mana value N or greater.
      const chosen = choices.exile ?? [];
      const yard = zoneList(g, 'graveyard', player);
      if (new Set(chosen).size !== chosen.length || !chosen.every((id) => yard.includes(id) && id !== o.id)) throw new RulesError('Choose cards in your graveyard to collect as evidence.');
      if (chosen.reduce((n, id) => n + manaValueOf(g, g.objects[id]!), 0) < Number(c.amount)) throw new RulesError(`Collect evidence ${c.amount}: total mana value ${c.amount} or greater.`);
    } else if (c.type === 'craft') {
      // CR 702.167a: exile this permanent and the materials.
      const n = Number(c.amount ?? 1);
      const chosen = choices.exile ?? [];
      const ok = craftCandidates(g, player, o, c);
      const count = c.anyNumber ? chosen.length >= n : chosen.length === n;
      if (o.zone !== 'battlefield' || !count || new Set(chosen).size !== chosen.length || !chosen.every((id) => ok.includes(id))) {
        throw new RulesError(`Choose ${c.anyNumber ? `${n} or more` : n} material(s) to craft with.`);
      }
    } else if (c.type === 'remove_counters') {
      // CR 118.3: "Remove two +1/+1 counters from among creatures you control" — the counters chosen, on permanents like that.
      const n = Number(c.amount ?? 1);
      const picks = choices.removed ?? [];
      const ok = counterCostCandidates(g, player, o, c);
      const kind = c.counter as string | undefined;
      const total = picks.reduce((t, p) => t + p.n, 0);
      const taken = new Map<string, number>();
      for (const p of picks) {
        const key = `${p.object}|${p.counter}`;
        taken.set(key, (taken.get(key) ?? 0) + p.n);
        const have = g.objects[p.object]?.counters[p.counter] ?? 0;
        if (!ok.includes(p.object) || (kind && p.counter !== kind) || !Number.isInteger(p.n) || p.n < 1 || taken.get(key)! > have) {
          throw new RulesError(`Choose ${n} ${kind ?? ''} counter(s) to remove from permanents you control.`.replace('  ', ' '));
        }
      }
      if (total !== n) throw new RulesError(`Choose ${n} counter(s) to remove.`);
    } else if (c.type === 'remove_counters_self' && c.amount === 'all') {
      // "Remove all +1/+1 counters from this creature" — however many there are, none included.
    } else if (c.type === 'remove_counters_self') {
      // CR 118.3: a cost can be paid only if it's possible — enough counters of that kind.
      const n = c.amount === 'X' ? (choices.counters ?? 0) : Number(c.amount ?? 1);
      if (!Number.isInteger(n) || n < 0) throw new RulesError('Choose how many counters to remove.');
      if ((o.counters[String(c.counter)] ?? 0) < n) throw new RulesError(`${nameOf(g, o)} doesn’t have enough ${c.counter} counters.`);
    } else if (c.type === 'pay_energy') {
      // CR 107.14: paying {E} removes an energy counter from you.
      if ((g.players[player]!.counters?.energy ?? 0) < Number(c.amount)) throw new RulesError(`You don’t have ${c.amount} energy.`);
    } else if (c.type === 'exile_cards') {
      const n = Number(c.amount ?? 1);
      const ok = exileCostCandidates(g, player, o, c);
      const chosen = choices.exile ?? [];
      if (chosen.length !== n || new Set(chosen).size !== n || !chosen.every((id) => ok.includes(id))) throw new RulesError(c.from === 'battlefield' ? `Choose ${n} permanent(s) you control to exile.` : `Choose ${n} other card(s) in your ${c.from === 'hand' ? 'hand' : 'graveyard'} to exile.`);
    } else if (c.type === 'process') {
      // Void Attendant: "Put a card an opponent owns from exile into that player's graveyard" — that many such cards.
      const n = Number(c.amount ?? 1);
      const ok = processCostCandidates(g, player);
      const chosen = choices.processed ?? [];
      if (chosen.length !== n || new Set(chosen).size !== n || !chosen.every((id) => ok.includes(id))) throw new RulesError(`Choose ${n} card(s) an opponent owns in exile.`);
    } else if (c.type === 'blight') {
      // CR 701.68b: with no creature to put the counters on, you can't blight.
      const chosen = choices.blighted ?? [];
      if (chosen.length !== 1 || !blightCandidates(g, player).includes(chosen[0]!)) throw new RulesError('Choose a creature you control to blight.');
    } else if (c.type === 'forage') {
      // CR 701.61a: "Exile three cards from your graveyard or sacrifice a Food."
      if (choices.forageFood) {
        const food = choices.sacrifice ?? [];
        if (food.length !== 1 || !foodCandidates(g, player).includes(food[0]!)) throw new RulesError('Choose a Food you control to sacrifice.');
      } else {
        const chosen = choices.exile ?? [];
        const yard = zoneList(g, 'graveyard', player).filter((id) => id !== o.id);
        if (chosen.length !== 3 || new Set(chosen).size !== 3 || !chosen.every((id) => yard.includes(id))) throw new RulesError('Choose three cards in your graveyard to exile (or a Food to sacrifice).');
      }
    } else if (c.type === 'reveal_from_hand' || c.type === 'behold') {
      const n = Number(c.amount ?? 1);
      const ok = revealCostCandidates(g, player, o, c);
      const chosen = choices.reveal ?? [];
      if (chosen.length !== n || new Set(chosen).size !== n || !chosen.every((id) => ok.includes(id))) throw new RulesError(c.type === 'behold' ? `Choose ${n} card(s) in your hand or permanent(s) you control to behold.` : `Choose ${n} card(s) in your hand to reveal.`);
    } else if (c.type === 'return_permanents') {
      const n = Number(c.amount ?? 1);
      const ok = returnCostCandidates(g, player, o, c);
      const chosen = choices.returned ?? [];
      if (chosen.length !== n || new Set(chosen).size !== n || !chosen.every((id) => ok.includes(id))) throw new RulesError(`Choose ${n} permanent(s) you control to return to your hand.`);
    } else if (c.type === 'tap_creatures') {
      const n = Number(c.amount ?? 1);
      const chosen = choices.crew ?? [];
      const ok = tapCostCandidates(g, player, o, c);
      const count = c.upTo ? chosen.length <= n : chosen.length === n;
      if (!count || new Set(chosen).size !== chosen.length || !chosen.every((id) => ok.includes(id))) throw new RulesError(`Choose ${c.upTo ? 'up to ' : ''}${n} untapped creature(s) you control to tap.`);
    } else if (c.type === 'crew') {
      // CR 702.122a: untapped creatures you control (not this one) with total power N or greater.
      const chosen = choices.crew ?? [];
      const ok = crewCandidates(g, player, o);
      if (new Set(chosen).size !== chosen.length || !chosen.every((id) => ok.includes(id))) throw new RulesError('Choose untapped creatures you control to crew it.');
      const total = chosen.reduce((n, id) => n + crewPower(g, g.objects[id]!), 0);
      if (total < Number(c.power)) throw new RulesError(`Crewing needs total power ${c.power} or greater.`);
    } else if (c.type === 'return_unblocked') {
      const chosen = choices.returned ?? [];
      if (chosen.length !== 1 || !unblockedAttackers(g, player).includes(chosen[0]!)) throw new RulesError('Choose an unblocked attacking creature you control to return.');
    } else if (c.type === 'station') {
      // CR 702.184a: "Tap another untapped creature you control".
      const chosen = choices.crew ?? [];
      if (chosen.length !== 1 || !crewCandidates(g, player, o).includes(chosen[0]!)) throw new RulesError('Choose another untapped creature you control to tap.');
    } else if (c.type === 'discard_hand') {
      // CR 701.9b: always possible, even with no cards in hand.
    } else if (c.type === 'exile_self_battlefield') {
      if (o.zone !== 'battlefield' || o.controller !== player) throw new RulesError(`You can’t exile ${nameOf(g, o)}.`);
    } else if (c.type === 'return_self') {
      if (o.zone !== 'battlefield' || o.controller !== player) throw new RulesError(`You can’t return ${nameOf(g, o)} to its owner's hand.`);
    } else if (c.type === 'put_counters_self') {
      // Devoted Druid: "Put a -1/-1 counter on this creature" — it must be on the battlefield (CR 118.3).
      if (o.zone !== 'battlefield') throw new RulesError(`${nameOf(g, o)} isn’t on the battlefield.`);
    } else if (c.type === 'mill') {
      // CR 701.17b: not more cards than the library has.
      if (zoneList(g, 'library', player).length < Number(c.amount ?? 1)) throw new RulesError('Your library doesn’t have enough cards to mill.');
    } else throw new RulesError(`Paying “${c.type}” isn’t supported yet.`);
  }
}

/** CR 608.2h: what the chosen sacrifice and discard costs were, before they're paid. */
export function costLKI(g: GameState, cost: Cost, choices: CostChoices = {}, source?: GameObject): CostLKI | undefined {
  const stats = (id: string) => lkiStats(g, g.objects[id]!);
  const sacrificed = (cost.other ?? []).some((c) => c.type === 'sacrifice') ? (choices.sacrifice ?? []).map(stats) : [];
  const discarded = (cost.other ?? []).some((c) => c.type === 'discard') ? (choices.discard ?? []).map(stats) : [];
  const exiled = (cost.other ?? []).some((c) => c.type === 'exile_cards' && c.from === 'battlefield') ? (choices.exile ?? []).map(stats) : [];
  // Station: "equal to the tapped creature's power" (CR 702.184a).
  const tapped = (cost.other ?? []).some((c) => c.type === 'station') ? (choices.crew ?? []).map(stats) : [];
  // Ninjutsu, sneak: what the returned creature was attacking.
  const returned = (cost.other ?? []).some((c) => c.type === 'return_unblocked') ? choices.returned?.[0] : undefined;
  const attackTarget = returned ? g.combat?.attackers[returned]?.target : undefined;
  // Molten Hydra: "Remove all +1/+1 counters from this creature" — how many that was.
  const removeAll = (cost.other ?? []).find((c) => c.type === 'remove_counters_self' && c.amount === 'all');
  const countersRemoved = removeAll && source ? (source.counters[String(removeAll.counter)] ?? 0) : undefined;
  if (!sacrificed.length && !discarded.length && !exiled.length && !tapped.length && !attackTarget && countersRemoved === undefined) return undefined;
  return {
    ...(countersRemoved !== undefined ? { countersRemoved } : {}),
    ...(sacrificed.length ? { sacrificed } : {}),
    ...(discarded.length ? { discarded } : {}),
    ...(exiled.length ? { exiled } : {}),
    ...(tapped.length ? { tapped } : {}),
    ...(attackTarget ? { attackTarget: { ...attackTarget } } : {}),
  };
}

export function payOtherCosts(g: GameState, player: PlayerId, o: GameObject, cost: Cost, events: GameEvent[], choices: CostChoices = {}): void {
  let sacUsed = 0;
  let discardUsed = 0;
  for (const c of cost.other ?? []) {
    if (c.type === 'sacrifice') {
      const n = Number(c.amount ?? 1);
      // CR 701.21a: each chosen permanent goes to its owner's graveyard.
      for (const id of (choices.sacrifice ?? []).slice(sacUsed, sacUsed + n)) {
        events.push({ type: 'sacrificed', object: id, player });
        moveObject(g, id, 'graveyard', events);
      }
      sacUsed += n;
      continue;
    }
    if (c.type === 'discard') {
      const n = Number(c.amount ?? 1);
      // CR 701.9a
      for (const id of (choices.discard ?? []).slice(discardUsed, discardUsed + n)) discardCard(g, id, events);
      discardUsed += n;
      continue;
    }
    if (c.type === 'pay_life') {
      const ps = g.players[player]!;
      const life = lifeLoss(g, player, lifeCost(g, player, o, c));
      ps.life -= life;
      events.push({ type: 'life', player, delta: -life, life: ps.life });
    } else if (c.type === 'sacrifice_self') {
      // CR 701.21a: sacrificing moves it from the battlefield to its owner's graveyard.
      events.push({ type: 'sacrificed', object: o.id, player });
      moveObject(g, o.id, 'graveyard', events);
    } else if (c.type === 'exert_self') {
      // CR 701.43a: "Exert this land" — it won't untap during its controller's next untap step.
      o.exerted = true;
      o.exertedTurn = g.turn;
      events.push({ type: 'exerted', object: o.id, player });
    } else if (c.type === 'mill') {
      // Millikin: "{T}, Mill a card: Add {C}." (CR 701.17a)
      for (const id of zoneList(g, 'library', player).slice(0, Number(c.amount ?? 1))) moveObject(g, id, 'graveyard', events);
    } else if (c.type === 'put_counters_self') {
      const counter = String(c.counter);
      const n = Number(c.amount ?? 1);
      o.counters[counter] = (o.counters[counter] ?? 0) + n;
      events.push({ type: 'counters', object: o.id, counter, delta: n, by: player });
    } else if (c.type === 'exile_self' || c.type === 'exile_self_hand' || c.type === 'exile_self_battlefield') {
      // CR 701.13a
      moveObject(g, o.id, 'exile', events);
    } else if (c.type === 'return_self') {
      moveObject(g, o.id, 'hand', events);
    } else if (c.type === 'discard_hand') {
      // CR 701.9b: "Discard your hand" — every card in it (possible with none).
      for (const id of [...zoneList(g, 'hand', player)]) discardCard(g, id, events);
    } else if (c.type === 'collect_evidence') {
      for (const id of choices.exile ?? []) moveObject(g, id, 'exile', events);
      events.push({ type: 'evidence_collected', player });
    } else if (c.type === 'craft') {
      moveObject(g, o.id, 'exile', events);
      for (const id of choices.exile ?? []) moveObject(g, id, 'exile', events);
    } else if (c.type === 'pay_energy') {
      payEnergy(g, player, Number(c.amount), events);
    } else if (c.type === 'remove_counters') {
      for (const p of choices.removed ?? []) {
        const t = g.objects[p.object]!;
        t.counters[p.counter] = (t.counters[p.counter] ?? 0) - p.n;
        if (t.counters[p.counter]! <= 0) delete t.counters[p.counter];
        events.push({ type: 'counters', object: t.id, counter: p.counter, delta: -p.n });
      }
    } else if (c.type === 'remove_counters_self') {
      const counter = String(c.counter);
      const n = c.amount === 'all' ? (o.counters[counter] ?? 0) : c.amount === 'X' ? (choices.counters ?? 0) : Number(c.amount ?? 1);
      o.counters[counter] = (o.counters[counter] ?? 0) - n;
      if (o.counters[counter]! <= 0) delete o.counters[counter];
      if (n > 0) events.push({ type: 'counters', object: o.id, counter, delta: -n });
    } else if (c.type === 'crew' || c.type === 'station' || c.type === 'tap_creatures') {
      for (const id of choices.crew ?? []) setTapped(g, id, true, events);
    } else if (c.type === 'return_unblocked' || c.type === 'return_permanents') {
      for (const id of choices.returned ?? []) moveObject(g, id, 'hand', events);
    } else if (c.type === 'exile_cards') {
      // CR 607.2a: what a cost exiles is "exiled with" its source — Fear of Abduction's "each card exiled with it" includes
      // the creature exiled to cast it (the permanent the spell becomes).
      for (const id of choices.exile ?? []) {
        moveObject(g, id, 'exile', events);
        const x = g.objects[id];
        // A spell's costs are paid before it moves to the stack (then onto the battlefield): two zone changes on.
        if (x?.zone === 'exile' && c.from === 'battlefield') x.exiledBy = { id: o.id, zcc: o.zone === 'battlefield' ? o.zcc : o.zone === 'stack' ? o.zcc + 1 : o.zcc + 2 };
      }
    } else if (c.type === 'process') {
      for (const id of choices.processed ?? []) moveObject(g, id, 'graveyard', events);
    } else if (c.type === 'blight') {
      const target = choices.blighted?.[0] ? g.objects[choices.blighted[0]] : undefined;
      if (target) blight(g, player, target, Number(c.amount ?? 1), events);
    } else if (c.type === 'forage') {
      if (choices.forageFood) {
        for (const id of choices.sacrifice ?? []) {
          events.push({ type: 'sacrificed', object: id, player });
          moveObject(g, id, 'graveyard', events);
        }
      } else for (const id of choices.exile ?? []) moveObject(g, id, 'exile', events);
      events.push({ type: 'foraged', player });
    } else if (c.type === 'reveal_from_hand' || c.type === 'behold') {
      // CR 701.20a / 701.4a: the cards from the hand are revealed; a beheld permanent is only chosen.
      const shown = (choices.reveal ?? []).filter((id) => g.objects[id]?.zone === 'hand');
      if (shown.length) events.push({ type: 'revealed', player, objects: shown });
      // Champions of the Perfect: "behold an Elf and exile it" — exiled with the permanent this spell becomes (CR 607.2a).
      if (c.exile) {
        for (const id of choices.reveal ?? []) {
          moveObject(g, id, 'exile', events);
          const x = g.objects[id];
          if (x?.zone === 'exile') x.exiledBy = { id: o.id, zcc: o.zone === 'battlefield' ? o.zcc : o.zone === 'stack' ? o.zcc + 1 : o.zcc + 2 };
        }
      }
    } else if (c.type === 'discard_self') {
      // CR 701.9a: discarding moves it from its owner's hand to their graveyard.
      discardCard(g, o.id, events);
    }
  }
}

/** Activates a mana ability: checks and pays its cost, then adds the mana at once (CR 605.3b). */
export function runManaAbility(
  g: GameState,
  player: PlayerId,
  id: ObjectId,
  index: number,
  choice: number | ManaColor | ManaMix | undefined,
  events: GameEvent[],
  costChoices: CostChoices = {},
  bonus: readonly (number | ManaColor)[] = [],
): void {
  const o = obj(g, id);
  // CR 602.2: only an object's controller can activate its abilities.
  const fromHand = o.zone === 'hand' && o.owner === player;
  if (!fromHand && (o.zone !== 'battlefield' || o.controller !== player)) throw new RulesError('You don’t control that permanent.');
  const ability = manaAbilities(g, o)[index];
  if (!ability) throw new RulesError(`${nameOf(g, o)} has no such mana ability.`);
  if (activationProhibited(g, player, o, true)) throw new RulesError(`You can’t activate ${nameOf(g, o)}’s abilities now.`);

  if (ability.cost.tap) {
    // CR 118.3: an already tapped permanent can't be tapped to pay a cost.
    if (o.tapped) throw new RulesError(`${nameOf(g, o)} is already tapped.`);
    // CR 302.6: summoning sickness.
    if (!canActivateTapAbilities(g, o)) throw new RulesError(`${nameOf(g, o)} hasn’t been under your control since your turn began.`);
  }
  if (ability.cost.untap && !o.tapped) throw new RulesError(`${nameOf(g, o)} is already untapped.`);
  // CR 302.6: the untap symbol too.
  if (ability.cost.untap && !canActivateTapAbilities(g, o)) throw new RulesError(`${nameOf(g, o)} hasn’t been under your control since your turn began.`);
  // CR 602.5b: "Activate only if you control a Swamp."
  if (ability.activateIf && !evalCondition(ability.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) {
    throw new RulesError(`${nameOf(g, o)}'s ability can't be activated now.`);
  }
  // CR 602.5d: "Activate only as a sorcery" — so not while casting a spell (it's on the stack), nor during combat.
  if (ability.timing === 'sorcery' && !(g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0)) {
    throw new RulesError('That ability can only be activated as a sorcery.');
  }
  // "Activate only once each turn." (kept apart from its other abilities' activations).
  const onceKey = -1 - index;
  if (ability.oncePerTurn && o.activatedTurn?.[onceKey] === g.turn) throw new RulesError('That ability can be activated only once each turn.');
  if (ability.oncePerTurn) (o.activatedTurn ??= {})[onceKey] = g.turn;
  // Manaforge Cinder: "Activate no more than three times each turn."
  if (ability.maxPerTurn) {
    const was = o.activations?.[onceKey];
    const n = was && was.turn === g.turn ? was.n : 0;
    if (n >= ability.maxPerTurn) throw new RulesError(`That ability can be activated no more than ${ability.maxPerTurn} times each turn.`);
    (o.activations ??= {})[onceKey] = { turn: g.turn, n: n + 1 };
  }
  checkOtherCosts(g, player, o, ability.cost, costChoices);
  const manaCost = ability.cost.mana ? parseManaCost(ability.cost.mana) : null;
  if (manaCost) abilityCostReductions(g, o, ability, manaCost, player);
  if (manaCost && !payMana(g, player, manaCost, 0, { kind: 'ability', source: o })) {
    throw new RulesError('Not enough mana in your pool to activate that.');
  }
  if (ability.cost.tap) setTapped(g, id, true, events);
  if (ability.cost.untap) setTapped(g, id, false, events);
  // CR 608.2h: "1 plus the exiled creature's mana value" — what the cost moved, as it was.
  const lki = costLKI(g, ability.cost, costChoices);
  payOtherCosts(g, player, o, ability.cost, events, costChoices);

  // CR 605.3b: mana abilities don't use the stack; they resolve immediately.
  const before = events.length;
  // Farrelite Priest: "If this ability has been activated four or more times this turn" — counting this activation.
  const counted = JSON.stringify(ability.effects).includes('"activated_times"') ? `${o.id}:${o.zcc}:${ability.text}` : undefined;
  if (counted) {
    const counts = (g.turnLog.abilityActivations ??= {});
    counts[counted] = (counts[counted] ?? 0) + 1;
  }
  const queue = [...ability.effects];
  // CR 106.12b: "it produces three times as much of that mana instead" — for an ability tapping the permanent.
  const times = ability.cost.tap && o.zone === 'battlefield' ? manaMultiplier(g, player, o) : 1;
  while (queue.length) {
    const e = queue.shift()!;
    const ok = runEffect(e, { g, controller: player, source: o, ...(choice !== undefined ? { choice } : {}), events, targets: [], x: costChoices.counters ?? 0, memo: {}, ...(lki ? { trigger: { lkiThisWay: lki } } : {}), ...(counted ? { manaAbilityKey: counted } : {}) });
    if (ok === true && e.type === 'add_mana') for (let k = 1; k < times; k++) runEffect(e, { g, controller: player, source: o, ...(choice !== undefined ? { choice } : {}), events, targets: [], x: costChoices.counters ?? 0, memo: {}, ...(lki ? { trigger: { lkiThisWay: lki } } : {}) });
    // "{T}: Add {G}. If you control another Mutant, you gain 1 life." — an "if" expands in place.
    if (typeof ok === 'object' && 'expand' in ok) queue.unshift(...ok.expand);
    else if (ok !== true) throw new RulesError(e.type === 'add_mana' ? 'Choose which mana to add.' : 'That mana ability can’t be resolved automatically.');
  }
  // CR 106.12a / 605.1b: "Whenever … is tapped for mana" — triggered mana abilities, resolved now too.
  if (ability.cost.tap) {
    const produced = events.slice(before).flatMap((ev) => (ev.type === 'mana_added' ? ev.mana : []));
    if (produced.length) tappedForMana(g, o, produced, events, bonus);
  }
}

/** The "whenever … is tapped for mana" abilities a permanent being tapped for mana triggers. */
function manaTriggersOf(g: GameState, tapped: GameObject): { src: GameObject; a: TriggeredAbility }[] {
  const out: { src: GameObject; a: TriggeredAbility }[] = [];
  for (const sid of abilitySources(g)) {
    const src = g.objects[sid];
    if (!src || src.zone !== 'battlefield') continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'triggered' || a.trigger.type !== 'tapped_for_mana') continue;
      // Regal Behemoth: "Whenever you tap a land for mana while you're the monarch".
      const during = a.trigger.while as ConditionNode | undefined;
      if (during && !evalCondition(during, { g, controller: src.controller, source: src, events: [], targets: [], x: 0, memo: {} })) continue;
      const subject = a.trigger.subject as Ref;
      const hit =
        subject.ref === 'attached'
          ? src.attachedTo?.id === tapped.id && src.attachedTo.zcc === tapped.zcc
          : subject.ref === 'all' && tapped.zone === 'battlefield' && matchesFilter(g, tapped, subject.filter, { controller: src.controller, source: src });
      if (hit || (subject.ref === 'self' && src.id === tapped.id)) out.push({ src, a });
    }
  }
  return out;
}

/** Whether additional mana from a trigger asks for a choice: "one mana of any color", "two mana in any combination of colors". */
const bonusChoice = (e: AddManaEffect): boolean => e.type === 'add_mana' && (Boolean(e.anyColor) || (e.options?.length ?? 0) > 1);

/**
 * Fertile Ground: "its controller adds an additional one mana of any color" — the ways the first such trigger can add its
 * mana as `tapped` is tapped for mana (an `activate_mana` action's `bonus`); empty when no trigger asks.
 */
export function bonusManaChoices(g: GameState, tapped: GameObject): (number | ManaColor)[] {
  for (const { src, a } of manaTriggersOf(g, tapped)) {
    if (a.trigger.producedColor) continue;
    const e = a.effects.find((x) => bonusChoice(x as AddManaEffect)) as AddManaEffect | undefined;
    if (!e) continue;
    if (e.anyColor) return anyColorChoices(g, a.trigger.its ? tapped.controller : src.controller, e.identity, e, src);
    return (e.options ?? []).map((_, i) => i);
  }
  return [];
}

function tappedForMana(g: GameState, tapped: GameObject, produced: ManaColor[], events: GameEvent[], bonus: readonly (number | ManaColor)[] = []): void {
  let asked = 0;
  for (const { src, a } of manaTriggersOf(g, tapped)) {
    // Forsaken Monument: "Whenever you tap a permanent for {C}" — only when that mana was made.
    // Caged Sun: "mana of the chosen color" — the color chosen as it entered.
    const wanted = a.trigger.producedColor === 'chosen' ? src.chosen?.color : a.trigger.producedColor;
    if (a.trigger.producedColor && (!wanted || !produced.includes(wanted as ManaColor))) continue;
    // Forbidden Orchard: not a mana ability (it doesn't add mana) — it goes on the stack like any trigger (CR 605.1b).
    if (!a.effects.every((x) => x.type === 'add_mana')) {
      // Price of Glory: "Whenever a player taps a land for mana, if it's not that player's turn, …" — who tapped it.
      g.triggers.push({ id: `t${g.nextId++}`, controller: src.controller, source: { id: src.id, zcc: src.zcc }, sourceName: nameOf(g, src), ability: a, info: { object: { id: tapped.id, zcc: tapped.zcc }, player: tapped.controller } });
      continue;
    }
    // "its controller adds …"; "add …" — the trigger's controller.
    const controller = a.trigger.its ? tapped.controller : src.controller;
    for (const effect of a.effects) {
      const run = effect.type === 'add_mana' && (effect as AddManaEffect).produced ? { type: 'add_mana', options: [[produced[0]!]] } : effect;
      // "one mana of any color": the color the action named (CR 605.3b — chosen as the mana ability resolves); tapped
      // automatically, the color the permanent itself made, if it made one.
      let choice: number | ManaColor | undefined;
      if (bonusChoice(run as AddManaEffect)) {
        const e = run as AddManaEffect;
        const named = bonus[asked++];
        if (e.anyColor) {
          const legal = anyColorChoices(g, controller, e.identity, e, src);
          choice = typeof named === 'string' && legal.includes(named) ? named : (legal.find((c) => produced.includes(c)) ?? legal[0]);
          if (choice === undefined) continue;
        } else choice = typeof named === 'number' && named >= 0 && named < e.options!.length ? named : 0;
      }
      runEffect(run, { g, controller, source: src, events, targets: [], x: 0, memo: {}, ...(choice !== undefined ? { choice } : {}) });
    }
  }
  // High Tide: "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}." (CR 514.2)
  for (const f of g.manaTriggers ?? []) {
    if (f.turn !== g.turn || g.step === 'cleanup') continue;
    const subject = f.ability.trigger.subject as Ref;
    if (subject.ref !== 'all' || tapped.zone !== 'battlefield' || !matchesFilter(g, tapped, subject.filter, { controller: f.controller, source: null })) continue;
    if (f.ability.trigger.producedColor && !produced.includes(f.ability.trigger.producedColor as ManaColor)) continue;
    const controller = f.ability.trigger.its ? tapped.controller : f.controller;
    for (const effect of f.ability.effects) {
      const run = effect.type === 'add_mana' && (effect as AddManaEffect).produced ? { type: 'add_mana', options: [[produced[0]!]] } : effect;
      runEffect(run, { g, controller, events, targets: [], x: 0, memo: {} });
    }
  }
}

/** CR 601.2g: activates mana abilities automatically to cover a cost beyond what's in the pool. */
export function autoTap(g: GameState, player: PlayerId, cost: ManaCost, x: number, events: GameEvent[], exclude: ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): void {
  // The cost's Phyrexian symbols were settled already (settlePhyrexian): what's left is paid with mana, never unasked-for life.
  const plan = planManaOnly(g, player, cost, x, exclude, purpose);
  if (!plan) throw new RulesError('You don’t have enough untapped mana sources.');
  for (const step of plan) runManaAbility(g, player, step.object, step.ability, step.choice, events);
}

/** CR 107.14: removes energy counters from a player. */
export function payEnergy(g: GameState, player: PlayerId, n: number, events: GameEvent[]): void {
  const counters = (g.players[player]!.counters ??= {});
  if ((counters.energy ?? 0) < n) throw new RulesError(`You don’t have ${n} energy.`);
  counters.energy = (counters.energy ?? 0) - n;
  events.push({ type: 'player_counters', player, counter: 'energy', delta: -n });
}

/** Pays a mana cost (or energy) as a spell or ability resolves (CR 118.12), tapping automatically. */
export function payDuringResolution(g: GameState, player: PlayerId, mana: string, events: GameEvent[], x = 0): void {
  if (/^(?:\{E\})+$/.test(mana)) {
    payEnergy(g, player, mana.length / 3, events);
    return;
  }
  const cost = parseManaCost(mana);
  if (cost.unsupported.length) throw new RulesError(`Paying ${mana} isn’t supported yet.`);
  if (!payFromPool(spendablePool(g, player, OTHER_PURPOSE), cost, x)) autoTap(g, player, cost, x, events);
  if (!payMana(g, player, cost, x, OTHER_PURPOSE)) throw new RulesError(`You can’t pay ${mana}.`);
}

/** Processors' costs: cards in exile an opponent of `player` owns. */
export function processCostCandidates(g: GameState, player: PlayerId): ObjectId[] {
  return g.zones.exile.filter((id) => g.objects[id]!.owner !== player && g.players[g.objects[id]!.owner] !== undefined);
}
