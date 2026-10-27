import type { Cost, EffectNode, ObjectFilter } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, hasType, manaAbilities, matchesFilter, power } from './characteristics.js';
import { parseManaCost, payFromPool, type ManaCost } from './mana.js';
import { runEffect } from './registry.js';
import { RulesError, type CostChoices, type GameEvent, type GameObject, type GameState, type ManaColor, type ObjectId, type PlayerId } from './types.js';
import { discardCard, moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';

/** Paying costs: mana abilities, automatic tapping, and non-mana costs (CR 118, CR 605). */

/** Non-mana cost tags the engine can pay. */
export const COST_TYPES: readonly string[] = ['sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards', 'remove_counters_self'];

/** Permanents a player could sacrifice for a "Sacrifice a creature" cost. */
export function sacrificeCandidates(g: GameState, player: PlayerId, c: EffectNode, source: GameObject): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  return g.zones.battlefield.filter((id) => {
    const p = g.objects[id]!;
    return p.controller === player && matchesFilter(g, p, filter, { controller: player, source });
  });
}

/** CR 702.122a: creatures that could crew a Vehicle. */
export function crewCandidates(g: GameState, player: PlayerId, vehicle: GameObject): ObjectId[] {
  return g.zones.battlefield.filter((id) => {
    const o = g.objects[id]!;
    return id !== vehicle.id && o.controller === player && !o.tapped && hasType(g, o, 'Creature');
  });
}

/** Cards a player could discard for a "Discard a card" cost (not the spell being cast). */
export function discardCandidates(g: GameState, player: PlayerId, source: GameObject): ObjectId[] {
  return zoneList(g, 'hand', player).filter((id) => id !== source.id);
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
export function exileCostCandidates(g: GameState, player: PlayerId, o: GameObject, c?: EffectNode): ObjectId[] {
  const filter = c?.filter as ObjectFilter | undefined;
  // "Exile a creature card from your graveyard"
  return zoneList(g, 'graveyard', player).filter((id) => id !== o.id && (!filter || matchesFilter(g, g.objects[id]!, { ...filter, zone: 'graveyard' }, { controller: player, source: o })));
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
      checkChosen(choices.discard?.slice(discardUsed, discardUsed + n), discardCandidates(g, player, o), n, 'card(s) to discard');
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
    } else if (c.type === 'remove_counters_self') {
      // CR 118.3: a cost can be paid only if it's possible — enough counters of that kind.
      if ((o.counters[String(c.counter)] ?? 0) < Number(c.amount ?? 1)) throw new RulesError(`${nameOf(g, o)} doesn’t have enough ${c.counter} counters.`);
    } else if (c.type === 'pay_energy') {
      // CR 107.14: paying {E} removes an energy counter from you.
      if ((g.players[player]!.counters?.energy ?? 0) < Number(c.amount)) throw new RulesError(`You don’t have ${c.amount} energy.`);
    } else if (c.type === 'exile_cards') {
      const n = Number(c.amount ?? 1);
      const ok = exileCostCandidates(g, player, o, c);
      const chosen = choices.exile ?? [];
      if (chosen.length !== n || new Set(chosen).size !== n || !chosen.every((id) => ok.includes(id))) throw new RulesError(`Choose ${n} other card(s) in your graveyard to exile.`);
    } else if (c.type === 'crew') {
      // CR 702.122a: untapped creatures you control (not this one) with total power N or greater.
      const chosen = choices.crew ?? [];
      const ok = crewCandidates(g, player, o);
      if (new Set(chosen).size !== chosen.length || !chosen.every((id) => ok.includes(id))) throw new RulesError('Choose untapped creatures you control to crew it.');
      const total = chosen.reduce((n, id) => n + power(g, g.objects[id]!), 0);
      if (total < Number(c.power)) throw new RulesError(`Crewing needs total power ${c.power} or greater.`);
    } else throw new RulesError(`Paying “${c.type}” isn’t supported yet.`);
  }
}

export function payOtherCosts(g: GameState, player: PlayerId, o: GameObject, cost: Cost, events: GameEvent[], choices: CostChoices = {}): void {
  let sacUsed = 0;
  let discardUsed = 0;
  for (const c of cost.other ?? []) {
    if (c.type === 'sacrifice') {
      const n = Number(c.amount ?? 1);
      // CR 701.21a: each chosen permanent goes to its owner's graveyard.
      for (const id of choices.sacrifice!.slice(sacUsed, sacUsed + n)) moveObject(g, id, 'graveyard', events);
      sacUsed += n;
      continue;
    }
    if (c.type === 'discard') {
      const n = Number(c.amount ?? 1);
      // CR 701.9a
      for (const id of choices.discard!.slice(discardUsed, discardUsed + n)) discardCard(g, id, events);
      discardUsed += n;
      continue;
    }
    if (c.type === 'pay_life') {
      const ps = g.players[player]!;
      ps.life -= Number(c.amount);
      events.push({ type: 'life', player, delta: -Number(c.amount), life: ps.life });
    } else if (c.type === 'sacrifice_self') {
      // CR 701.21a: sacrificing moves it from the battlefield to its owner's graveyard.
      moveObject(g, o.id, 'graveyard', events);
    } else if (c.type === 'exile_self') {
      // CR 701.13a
      moveObject(g, o.id, 'exile', events);
    } else if (c.type === 'pay_energy') {
      payEnergy(g, player, Number(c.amount), events);
    } else if (c.type === 'remove_counters_self') {
      const counter = String(c.counter);
      const n = Number(c.amount ?? 1);
      o.counters[counter] = (o.counters[counter] ?? 0) - n;
      if (o.counters[counter]! <= 0) delete o.counters[counter];
      events.push({ type: 'counters', object: o.id, counter, delta: -n });
    } else if (c.type === 'crew') {
      for (const id of choices.crew ?? []) setTapped(g, id, true, events);
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
  checkOtherCosts(g, player, o, ability.cost, costChoices);
  const pool = g.players[player]!.pool;
  if (ability.cost.mana) {
    const left = payFromPool(pool, parseManaCost(ability.cost.mana));
    if (!left) throw new RulesError('Not enough mana in your pool to activate that.');
    g.players[player]!.pool = left;
  }
  if (ability.cost.tap) setTapped(g, id, true, events);
  if (ability.cost.untap) setTapped(g, id, false, events);
  payOtherCosts(g, player, o, ability.cost, events, costChoices);

  // CR 605.3b: mana abilities don't use the stack; they resolve immediately.
  const queue = [...ability.effects];
  while (queue.length) {
    const e = queue.shift()!;
    const ok = runEffect(e, { g, controller: player, source: o, ...(choice !== undefined ? { choice } : {}), events, targets: [], x: 0, memo: {} });
    // "{T}: Add {G}. If you control another Mutant, you gain 1 life." — an "if" expands in place.
    if (typeof ok === 'object' && 'expand' in ok) queue.unshift(...ok.expand);
    else if (ok !== true) throw new RulesError(e.type === 'add_mana' ? 'Choose which mana to add.' : 'That mana ability can’t be resolved automatically.');
  }
}

/** CR 601.2g: activates mana abilities automatically to cover a cost beyond what's in the pool. */
export function autoTap(g: GameState, player: PlayerId, cost: ManaCost, x: number, events: GameEvent[], exclude: ObjectId[] = []): void {
  const plan = planAutoTap(g, player, cost, x, exclude);
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
  if (!payFromPool(g.players[player]!.pool, cost)) autoTap(g, player, cost, 0, events);
  const left = payFromPool(g.players[player]!.pool, cost);
  if (!left) throw new RulesError(`You can’t pay ${mana}.`);
  g.players[player]!.pool = left;
}
