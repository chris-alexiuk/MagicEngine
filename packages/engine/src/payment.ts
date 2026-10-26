import type { Cost, EffectNode, ObjectFilter } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, manaAbilities, matchesFilter } from './characteristics.js';
import { parseManaCost, payFromPool, type ManaCost } from './mana.js';
import { runEffect } from './registry.js';
import { RulesError, type CostChoices, type GameEvent, type GameObject, type GameState, type ManaColor, type ObjectId, type PlayerId } from './types.js';
import { moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';

/** Paying costs: mana abilities, automatic tapping, and non-mana costs (CR 118, CR 605). */

/** Non-mana cost tags the engine can pay. */
export const COST_TYPES: readonly string[] = ['sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard'];

/** Permanents a player could sacrifice for a "Sacrifice a creature" cost. */
export function sacrificeCandidates(g: GameState, player: PlayerId, c: EffectNode, source: GameObject): ObjectId[] {
  const filter = (c.filter ?? {}) as ObjectFilter;
  return g.zones.battlefield.filter((id) => {
    const p = g.objects[id]!;
    return p.controller === player && matchesFilter(g, p, filter, { controller: player, source });
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
      for (const id of choices.discard!.slice(discardUsed, discardUsed + n)) moveObject(g, id, 'graveyard', events);
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
    } else if (c.type === 'discard_self') {
      // CR 701.9a: discarding moves it from its owner's hand to their graveyard.
      moveObject(g, o.id, 'graveyard', events);
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
  for (const e of ability.effects) {
    const ok = runEffect(e, { g, controller: player, source: o, ...(choice !== undefined ? { choice } : {}), events, targets: [], x: 0, memo: {} });
    if (ok !== true) throw new RulesError('Choose which mana to add.');
  }
}

/** CR 601.2g: activates mana abilities automatically to cover a cost beyond what's in the pool. */
export function autoTap(g: GameState, player: PlayerId, cost: ManaCost, x: number, events: GameEvent[], exclude: ObjectId[] = []): void {
  const plan = planAutoTap(g, player, cost, x, exclude);
  if (!plan) throw new RulesError('You don’t have enough untapped mana sources.');
  for (const step of plan) runManaAbility(g, player, step.object, step.ability, step.choice, events);
}

/** Pays a mana cost as a spell or ability resolves (CR 118.12), tapping automatically. */
export function payDuringResolution(g: GameState, player: PlayerId, mana: string, events: GameEvent[]): void {
  const cost = parseManaCost(mana);
  if (cost.unsupported.length) throw new RulesError(`Paying ${mana} isn’t supported yet.`);
  if (!payFromPool(g.players[player]!.pool, cost)) autoTap(g, player, cost, 0, events);
  const left = payFromPool(g.players[player]!.pool, cost);
  if (!left) throw new RulesError(`You can’t pay ${mana}.`);
  g.players[player]!.pool = left;
}
