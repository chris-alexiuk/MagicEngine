import { evalCondition } from './conditions.js';
import type { Cost, EffectNode, ObjectFilter } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, hasType, manaAbilities, matchesFilter, power, toughness } from './characteristics.js';
import { parseManaCost, payFromPool, type ManaCost } from './mana.js';
import { OTHER_PURPOSE, payMana, spendablePool, type ManaPurpose } from './spending.js';
import { runEffect } from './registry.js';
import { RulesError, type CostChoices, type CostLKI, type GameEvent, type GameObject, type GameState, type ManaColor, type ObjectId, type PlayerId } from './types.js';
import { discardCard, manaValueOf, moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';

/** Paying costs: mana abilities, automatic tapping, and non-mana costs (CR 118, CR 605). */

/** Non-mana cost tags the engine can pay. */
export const COST_TYPES: readonly string[] = ['sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards', 'remove_counters_self', 'station', 'return_unblocked', 'tap_creatures', 'craft', 'collect_evidence', 'return_permanents'];

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
  // "Exile a creature card from your graveyard"; "exile a blue card from your hand" (Force of Will).
  const zone = c?.from === 'hand' ? 'hand' : 'graveyard';
  return zoneList(g, zone, player).filter((id) => id !== o.id && (!filter || matchesFilter(g, g.objects[id]!, { ...filter, zone }, { controller: player, source: o })));
}

/** "Return an Island you control to its owner's hand" as a cost: permanents you control like that. */
export function returnCostCandidates(g: GameState, player: PlayerId, o: GameObject, c: EffectNode): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  return g.zones.battlefield.filter((id) => id !== o.id && g.objects[id]!.controller === player && matchesFilter(g, g.objects[id]!, filter, { controller: player, source: o }));
}

export function checkOtherCosts(g: GameState, player: PlayerId, o: GameObject, cost: Cost, choices: CostChoices = {}): void {
  // Two costs can't both use the same chosen object.
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
    } else if (c.type === 'pay_life') {
      // CR 119.4: a player can pay life only if their life total is at least that much.
      if (g.players[player]!.life < Number(c.amount)) throw new RulesError(`You don’t have ${c.amount} life to pay.`);
    } else if (c.type === 'discard_self') {
      if (o.zone !== 'hand' || o.owner !== player) throw new RulesError(`${nameOf(g, o)} isn’t in your hand.`);
    } else if (c.type === 'exile_self') {
      if (o.zone !== 'graveyard' || o.owner !== player) throw new RulesError(`${nameOf(g, o)} isn’t in your graveyard.`);
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
      if (chosen.length !== n || new Set(chosen).size !== n || !chosen.every((id) => ok.includes(id))) throw new RulesError(`Choose ${n} other card(s) in your ${c.from === 'hand' ? 'hand' : 'graveyard'} to exile.`);
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
      const total = chosen.reduce((n, id) => n + power(g, g.objects[id]!), 0);
      if (total < Number(c.power)) throw new RulesError(`Crewing needs total power ${c.power} or greater.`);
    } else if (c.type === 'return_unblocked') {
      const chosen = choices.returned ?? [];
      if (chosen.length !== 1 || !unblockedAttackers(g, player).includes(chosen[0]!)) throw new RulesError('Choose an unblocked attacking creature you control to return.');
    } else if (c.type === 'station') {
      // CR 702.184a: "Tap another untapped creature you control".
      const chosen = choices.crew ?? [];
      if (chosen.length !== 1 || !crewCandidates(g, player, o).includes(chosen[0]!)) throw new RulesError('Choose another untapped creature you control to tap.');
    } else throw new RulesError(`Paying “${c.type}” isn’t supported yet.`);
  }
}

/** CR 608.2h: what the chosen sacrifice and discard costs were, before they're paid. */
export function costLKI(g: GameState, cost: Cost, choices: CostChoices = {}): CostLKI | undefined {
  const stats = (id: string) => {
    const o = g.objects[id]!;
    return { power: power(g, o), toughness: toughness(g, o), mana_value: manaValueOf(g, o) };
  };
  const sacrificed = (cost.other ?? []).some((c) => c.type === 'sacrifice') ? (choices.sacrifice ?? []).map(stats) : [];
  const discarded = (cost.other ?? []).some((c) => c.type === 'discard') ? (choices.discard ?? []).map(stats) : [];
  // Station: "equal to the tapped creature's power" (CR 702.184a).
  const tapped = (cost.other ?? []).some((c) => c.type === 'station') ? (choices.crew ?? []).map(stats) : [];
  // Ninjutsu, sneak: what the returned creature was attacking.
  const returned = (cost.other ?? []).some((c) => c.type === 'return_unblocked') ? choices.returned?.[0] : undefined;
  const attackTarget = returned ? g.combat?.attackers[returned]?.target : undefined;
  if (!sacrificed.length && !discarded.length && !tapped.length && !attackTarget) return undefined;
  return {
    ...(sacrificed.length ? { sacrificed } : {}),
    ...(discarded.length ? { discarded } : {}),
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
      ps.life -= Number(c.amount);
      events.push({ type: 'life', player, delta: -Number(c.amount), life: ps.life });
    } else if (c.type === 'sacrifice_self') {
      // CR 701.21a: sacrificing moves it from the battlefield to its owner's graveyard.
      events.push({ type: 'sacrificed', object: o.id, player });
      moveObject(g, o.id, 'graveyard', events);
    } else if (c.type === 'exile_self') {
      // CR 701.13a
      moveObject(g, o.id, 'exile', events);
    } else if (c.type === 'collect_evidence') {
      for (const id of choices.exile ?? []) moveObject(g, id, 'exile', events);
      events.push({ type: 'evidence_collected', player });
    } else if (c.type === 'craft') {
      moveObject(g, o.id, 'exile', events);
      for (const id of choices.exile ?? []) moveObject(g, id, 'exile', events);
    } else if (c.type === 'pay_energy') {
      payEnergy(g, player, Number(c.amount), events);
    } else if (c.type === 'remove_counters_self') {
      const counter = String(c.counter);
      const n = c.amount === 'X' ? (choices.counters ?? 0) : Number(c.amount ?? 1);
      o.counters[counter] = (o.counters[counter] ?? 0) - n;
      if (o.counters[counter]! <= 0) delete o.counters[counter];
      events.push({ type: 'counters', object: o.id, counter, delta: -n });
    } else if (c.type === 'crew' || c.type === 'station' || c.type === 'tap_creatures') {
      for (const id of choices.crew ?? []) setTapped(g, id, true, events);
    } else if (c.type === 'return_unblocked' || c.type === 'return_permanents') {
      for (const id of choices.returned ?? []) moveObject(g, id, 'hand', events);
    } else if (c.type === 'exile_cards') {
      for (const id of choices.exile ?? []) moveObject(g, id, 'exile', events);
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
  choice: number | ManaColor | undefined,
  events: GameEvent[],
  costChoices: CostChoices = {},
): void {
  const o = obj(g, id);
  // CR 602.2: only an object's controller can activate its abilities.
  if (o.zone !== 'battlefield' || o.controller !== player) throw new RulesError('You don’t control that permanent.');
  const ability = manaAbilities(g, o)[index];
  if (!ability) throw new RulesError(`${nameOf(g, o)} has no such mana ability.`);

  if (ability.cost.tap) {
    // CR 118.3: an already tapped permanent can't be tapped to pay a cost.
    if (o.tapped) throw new RulesError(`${nameOf(g, o)} is already tapped.`);
    // CR 302.6: summoning sickness.
    if (!canUseTapAbilities(g, o)) throw new RulesError(`${nameOf(g, o)} hasn’t been under your control since your turn began.`);
  }
  if (ability.cost.untap && !o.tapped) throw new RulesError(`${nameOf(g, o)} is already untapped.`);
  // CR 602.5b: "Activate only if you control a Swamp."
  if (ability.activateIf && !evalCondition(ability.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) {
    throw new RulesError(`${nameOf(g, o)}'s ability can't be activated now.`);
  }
  // "Activate only once each turn." (kept apart from its other abilities' activations).
  const onceKey = -1 - index;
  if (ability.oncePerTurn && o.activatedTurn?.[onceKey] === g.turn) throw new RulesError('That ability can be activated only once each turn.');
  if (ability.oncePerTurn) (o.activatedTurn ??= {})[onceKey] = g.turn;
  checkOtherCosts(g, player, o, ability.cost, costChoices);
  if (ability.cost.mana && !payMana(g, player, parseManaCost(ability.cost.mana), 0, { kind: 'ability', source: o })) {
    throw new RulesError('Not enough mana in your pool to activate that.');
  }
  if (ability.cost.tap) setTapped(g, id, true, events);
  if (ability.cost.untap) setTapped(g, id, false, events);
  payOtherCosts(g, player, o, ability.cost, events, costChoices);

  // CR 605.3b: mana abilities don't use the stack; they resolve immediately.
  const queue = [...ability.effects];
  while (queue.length) {
    const e = queue.shift()!;
    const ok = runEffect(e, { g, controller: player, source: o, ...(choice !== undefined ? { choice } : {}), events, targets: [], x: costChoices.counters ?? 0, memo: {} });
    // "{T}: Add {G}. If you control another Mutant, you gain 1 life." — an "if" expands in place.
    if (typeof ok === 'object' && 'expand' in ok) queue.unshift(...ok.expand);
    else if (ok !== true) throw new RulesError(e.type === 'add_mana' ? 'Choose which mana to add.' : 'That mana ability can’t be resolved automatically.');
  }
}

/** CR 601.2g: activates mana abilities automatically to cover a cost beyond what's in the pool. */
export function autoTap(g: GameState, player: PlayerId, cost: ManaCost, x: number, events: GameEvent[], exclude: ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): void {
  const plan = planAutoTap(g, player, cost, x, exclude, purpose);
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
export function payDuringResolution(g: GameState, player: PlayerId, mana: string, events: GameEvent[]): void {
  if (/^(?:\{E\})+$/.test(mana)) {
    payEnergy(g, player, mana.length / 3, events);
    return;
  }
  const cost = parseManaCost(mana);
  if (cost.unsupported.length) throw new RulesError(`Paying ${mana} isn’t supported yet.`);
  if (!payFromPool(spendablePool(g, player, OTHER_PURPOSE), cost)) autoTap(g, player, cost, 0, events);
  if (!payMana(g, player, cost, 0, OTHER_PURPOSE)) throw new RulesError(`You can’t pay ${mana}.`);
}
