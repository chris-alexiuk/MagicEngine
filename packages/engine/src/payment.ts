import { activationProhibited } from './cast-bans.js';
import { evalCondition } from './conditions.js';
import { playerRule } from './player-rules.js';
import type { AddManaEffect, Amount, ConditionNode, Cost, EffectNode, ObjectFilter, Ref, TriggeredAbility } from '@mtg/schema';
import { amountOf } from './resolve.js';
import { planManaOnly, settlePhyrexian, type PlannedActivation } from './autotap.js';
import { abilityOfKeyword, canActivateTapAbilities, hasRule, hasType, isPermanentCard, lkiStats, manaAbilities, manaMultiplier, matchesFilter, objectAbilities, power, toughness } from './characteristics.js';
import { anyColorChoices, parseManaCost, payFromPool, shortfall, type ManaCost } from './mana.js';
import { canPayMana, OTHER_PURPOSE, payMana, spendablePool, type ManaPurpose } from './spending.js';
import { runEffect } from './registry.js';
import { RulesError, type CostChoices, type CostLKI, type GameEvent, type GameObject, type GameState, type ManaColor, type ManaMix, type ObjectId, type PlayerId } from './types.js';
import { abilitySources, discardCard, faceOf, manaValueOf, moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';
import { cantLoseLife, lifeLoss, replaceQuantity } from './quantities.js';
import { nextRandom } from './rng.js';

/** Paying costs: mana abilities, automatic tapping, and non-mana costs (CR 118, CR 605). */

/** Non-mana cost tags the engine can pay. */
export const COST_TYPES: readonly string[] = ['exert_self', 'sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards', 'remove_counters_self', 'station', 'return_unblocked', 'tap_creatures', 'craft', 'collect_evidence', 'return_permanents', 'reveal_from_hand', 'behold', 'blight', 'forage', 'exile_self_hand', 'discard_hand', 'exile_self_battlefield', 'put_counters_self', 'mill', 'return_self', 'remove_counters', 'process', 'exile_top'];

/**
 * CR 607.2a: the object a cost's exiled cards are "exiled with", as it will be when its abilities ask (CR 400.7: it is a
 * new object after each zone change) — a permanent as it is; a permanent spell as the permanent it becomes (its costs
 * are paid before it moves to the stack, then it enters: two zone changes on); an instant or sorcery as the spell on
 * the stack (one).
 */
function linkedZcc(g: GameState, o: GameObject): number {
  if (o.zone === 'battlefield') return o.zcc;
  return o.zcc + (o.zone === 'stack' ? 0 : 1) + (isPermanentCard(faceOf(g, o)) ? 1 : 0);
}

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
    // Halo Fountain: "Untap a tapped creature you control" — the same choice, of tapped ones.
    return id !== source.id && o.controller === player && (c.untap ? o.tapped : !o.tapped) && matchesFilter(g, o, (c.filter ?? {}) as ObjectFilter, { controller: player, source });
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

/**
 * "Discard a card at random" costs (Pyromancy, Acceptable Losses): the cards are picked at random as the cost is paid
 * (CR 701.9b), whatever was chosen for them; choices for the other discard costs keep their places.
 */
export function withRandomDiscards(g: GameState, player: PlayerId, source: GameObject, cost: Cost, choices: CostChoices = {}): CostChoices {
  const costs = (cost.other ?? []).filter((c) => c.type === 'discard');
  if (!costs.some((c) => c.random)) return choices;
  const given = choices.discard ?? [];
  const total = costs.reduce((n, c) => n + Number(c.amount ?? 1), 0);
  const chosen = costs.filter((c) => !c.random).reduce((n, c) => n + Number(c.amount ?? 1), 0);
  const out: ObjectId[] = [];
  let k = 0;
  for (const c of costs) {
    const n = Number(c.amount ?? 1);
    if (!c.random) {
      out.push(...given.slice(k, k + n));
      k += n;
      continue;
    }
    // Entries given for a random discard (one for every discard cost) are passed over.
    if (given.length >= total && given.length > chosen) k += n;
    const pool = discardCandidates(g, player, source, c.filter as ObjectFilter | undefined).filter((id) => !out.includes(id) && !given.slice(k).includes(id));
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(nextRandom(g) * pool.length), 1)[0]!);
  }
  return { ...choices, discard: out };
}

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
      // Fighter Class: "Equip abilities you activate …" (CR 702.6a); Silver-Fur Master: "Ninjutsu abilities …";
      // Fluctuator: "Cycling abilities …" — the abilities of that keyword.
      if (typeof a.effect.keyword === 'string' && !abilityOfKeyword(ability.text, a.effect.keyword)) continue;
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

/** The lists of an action's `costs` that hold objects chosen to pay with. */
export type CostList = 'sacrifice' | 'discard' | 'exile' | 'crew' | 'returned' | 'reveal' | 'blighted' | 'processed';

/**
 * One part of a cost that is paid with objects its payer chooses (CR 601.2h): "Sacrifice a creature", "Discard two
 * cards", "Exile five other cards from your graveyard", "Tap an untapped creature you control", a Vehicle's crew cost.
 * This is the one description of that choice: the check as an action is applied, the payment, the default the
 * legal-action list fills in and what a client asks the player all read it.
 */
export interface CostAsk {
  /** The part of the cost. */
  part: EffectNode;
  /** Which list of the action's `costs` its objects are in… */
  list: CostList;
  /** …starting where: parts that share a list take theirs in the cost's order. */
  at: number;
  /** How many: exactly `min` when `max` is the same. A part that takes any number takes the rest of its list. */
  min: number;
  max: number;
  candidates: ObjectId[];
  /** A total the chosen objects must reach: a crew cost's power, collected evidence's mana value. */
  total?: { need: number; of: 'power' | 'mana value'; short: string };
  /** What the engine says to a choice it can't accept. */
  refusal: string;
  /** What is done with them, for a prompt: "sacrifice", "discard", "exile", "tap", "return to your hand"… */
  verb: string;
  /** What they are, one and several: "permanent", "cards in your graveyard". */
  what: [string, string];
  /** "Discard a card at random": picked as the cost is paid (CR 701.9b), never chosen. */
  random?: true;
}

const WHAT: Record<CostList, [string, string]> = {
  sacrifice: ['permanent', 'permanents'],
  discard: ['card', 'cards'],
  exile: ['card in your graveyard', 'cards in your graveyard'],
  crew: ['creature', 'creatures'],
  returned: ['permanent', 'permanents'],
  reveal: ['card in your hand', 'cards in your hand'],
  blighted: ['creature', 'creatures'],
  processed: ['card in exile an opponent owns', 'cards in exile an opponent owns'],
};

/** What a cost's filter asks for, where that is one plain thing: "creature", "Squirrel", "other artifact". */
function nounOf(c: EffectNode, fallback: [string, string]): [string, string] {
  const f = (c.filter ?? {}) as ObjectFilter;
  const one = f.subtypes?.length === 1 && !f.types?.length ? f.subtypes[0]! : f.types?.length === 1 && !f.subtypes?.length ? f.types[0]!.toLowerCase() : undefined;
  if (!one || f.anyOf) return fallback;
  const other = f.other ? 'other ' : '';
  return [`${other}${one}`, `${other}${one}s`];
}

/** The parts of a cost that take chosen objects, in the cost's order, with where each one's objects are in `choices`. */
export function costAsks(g: GameState, player: PlayerId, o: GameObject, cost: Cost, choices: CostChoices = {}): CostAsk[] {
  const used: Partial<Record<CostList, number>> = {};
  const out: CostAsk[] = [];
  const add = (part: EffectNode, list: CostList, min: number, max: number, candidates: ObjectId[], verb: string, refusal: string, more: Partial<CostAsk> = {}): void => {
    const at = used[list] ?? 0;
    used[list] = at + (min === max ? (Number.isFinite(max) ? max : 0) : Math.max(0, (choices[list]?.length ?? 0) - at));
    out.push({ part, list, at, min, max, candidates, verb, refusal, what: WHAT[list], ...more });
  };
  // Random discards are in the list once they have been picked (withRandomDiscards), and before that only when an entry
  // was given for every discard cost.
  const discards = (cost.other ?? []).filter((c) => c.type === 'discard');
  const everyDiscard = discards.reduce((n, c) => n + Number(c.amount ?? 1), 0);
  const chosenDiscards = discards.filter((c) => !c.random).reduce((n, c) => n + Number(c.amount ?? 1), 0);
  const randomListed = (choices.discard?.length ?? 0) >= everyDiscard && (choices.discard?.length ?? 0) > chosenDiscards;
  for (const c of cost.other ?? []) {
    const n = Number(c.amount ?? 1);
    // "Sacrifice all creatures you control" leaves nothing to choose (the spell's cast fills them in); "any number" takes
    // as many as were chosen.
    if (c.amount === 'all') continue;
    const some = c.amount === 'any';
    if (c.type === 'sacrifice') add(c, 'sacrifice', some ? 0 : n, some ? Infinity : n, sacrificeCandidates(g, player, c, o), 'sacrifice', `Choose ${n} permanent(s) to sacrifice to pay the cost.`, { what: nounOf(c, WHAT.sacrifice) });
    else if (c.type === 'discard') {
      const candidates = discardCandidates(g, player, o, c.filter as ObjectFilter | undefined);
      if (!c.random) add(c, 'discard', n, n, candidates, 'discard', `Choose ${n} card(s) to discard to pay the cost.`);
      else {
        const at = used.discard ?? 0;
        if (randomListed) used.discard = at + n;
        out.push({ part: c, list: 'discard', at, min: n, max: n, candidates, verb: 'discard', what: WHAT.discard, refusal: `Choose ${n} card(s) to discard to pay the cost.`, random: true });
      }
    } else if (c.type === 'collect_evidence') {
      // CR 701.59a: exile cards from your graveyard with total mana value N or greater.
      const yard = zoneList(g, 'graveyard', player).filter((id) => id !== o.id);
      add(c, 'exile', 0, Infinity, yard, 'exile', 'Choose cards in your graveyard to collect as evidence.', { total: { need: n, of: 'mana value', short: `Collect evidence ${c.amount}: total mana value ${c.amount} or greater.` } });
    } else if (c.type === 'craft') {
      // CR 702.167a: exile this permanent and the materials.
      add(c, 'exile', n, c.anyNumber ? Infinity : n, o.zone === 'battlefield' ? craftCandidates(g, player, o, c) : [], 'exile', `Choose ${c.anyNumber ? `${n} or more` : n} material(s) to craft with.`, { what: ['material', 'materials'] });
    } else if (c.type === 'exile_cards') {
      add(c, 'exile', some ? 0 : n, some ? Infinity : n, exileCostCandidates(g, player, o, c), 'exile', c.from === 'battlefield' ? `Choose ${n} permanent(s) you control to exile.` : `Choose ${n} other card(s) in your ${c.from === 'hand' ? 'hand' : 'graveyard'} to exile.`, c.from === 'battlefield' ? { what: nounOf(c, WHAT.sacrifice) } : c.from === 'hand' ? { what: WHAT.reveal } : {});
    } else if (c.type === 'process') {
      // Void Attendant: "Put a card an opponent owns from exile into that player's graveyard" — that many such cards.
      add(c, 'processed', n, n, processCostCandidates(g, player), "put into its owner's graveyard", `Choose ${n} card(s) an opponent owns in exile.`);
    } else if (c.type === 'blight') {
      // CR 701.68b: with no creature to put the counters on, you can't blight.
      add(c, 'blighted', 1, 1, blightCandidates(g, player), 'blight', 'Choose a creature you control to blight.');
    } else if (c.type === 'forage') {
      // CR 701.61a: "Exile three cards from your graveyard or sacrifice a Food."
      if (choices.forageFood) add(c, 'sacrifice', 1, 1, foodCandidates(g, player), 'sacrifice', 'Choose a Food you control to sacrifice.', { what: ['Food', 'Foods'] });
      else add(c, 'exile', 3, 3, zoneList(g, 'graveyard', player).filter((id) => id !== o.id), 'exile', 'Choose three cards in your graveyard to exile (or a Food to sacrifice).');
    } else if (c.type === 'reveal_from_hand' || c.type === 'behold') {
      add(c, 'reveal', n, n, revealCostCandidates(g, player, o, c), c.type === 'behold' ? 'behold' : 'reveal', c.type === 'behold' ? `Choose ${n} card(s) in your hand or permanent(s) you control to behold.` : `Choose ${n} card(s) in your hand to reveal.`, c.type === 'behold' ? { what: ['card in your hand or permanent you control', 'cards in your hand or permanents you control'] } : {});
    } else if (c.type === 'return_permanents') {
      add(c, 'returned', n, n, returnCostCandidates(g, player, o, c), 'return to your hand', `Choose ${n} permanent(s) you control to return to your hand.`, { what: nounOf(c, WHAT.returned) });
    } else if (c.type === 'return_unblocked') {
      add(c, 'returned', 1, 1, unblockedAttackers(g, player), "return to its owner's hand", 'Choose an unblocked attacking creature you control to return.', { what: ['unblocked attacking creature', 'unblocked attacking creatures'] });
    } else if (c.type === 'tap_creatures') {
      add(c, 'crew', c.upTo ? 0 : n, n, tapCostCandidates(g, player, o, c), c.untap ? 'untap' : 'tap', `Choose ${c.upTo ? 'up to ' : ''}${n} ${c.untap ? 'tapped' : 'untapped'} creature(s) you control to ${c.untap ? 'untap' : 'tap'}.`, c.untap ? { what: ['tapped creature', 'tapped creatures'] } : {});
    } else if (c.type === 'crew') {
      // CR 702.122a: untapped creatures you control (not this one) with total power N or greater.
      add(c, 'crew', 0, Infinity, crewCandidates(g, player, o), 'tap', 'Choose untapped creatures you control to crew it.', { total: { need: Number(c.power), of: 'power', short: `Crewing needs total power ${c.power} or greater.` } });
    } else if (c.type === 'station') {
      // CR 702.184a: "Tap another untapped creature you control".
      add(c, 'crew', 1, 1, crewCandidates(g, player, o), 'tap', 'Choose another untapped creature you control to tap.', { what: ['other creature', 'other creatures'] });
    }
  }
  return out;
}

/** What was chosen for one part of a cost. */
export function chosenFor(ask: CostAsk, choices: CostChoices): ObjectId[] {
  const list = choices[ask.list] ?? [];
  return ask.min === ask.max ? list.slice(ask.at, ask.at + ask.max) : list.slice(ask.at);
}

/** What a chosen object counts for toward a part's total: its power for a crew cost, its mana value for evidence. */
export function costWeight(g: GameState, ask: CostAsk, id: ObjectId): number {
  const o = g.objects[id];
  return !o ? 0 : ask.total?.of === 'power' ? crewPower(g, o) : manaValueOf(g, o);
}

/** CR 118.3: a cost can be paid only with what it asks for. Throws what the engine says otherwise. */
function checkAsk(g: GameState, ask: CostAsk, choices: CostChoices): void {
  const chosen = chosenFor(ask, choices);
  if (chosen.length < ask.min || chosen.length > ask.max || !Number.isInteger(ask.min) || new Set(chosen).size !== chosen.length || !chosen.every((id) => ask.candidates.includes(id))) throw new RulesError(ask.refusal);
  if (ask.total && chosen.reduce((n, id) => n + costWeight(g, ask, id), 0) < ask.total.need) throw new RulesError(ask.total.short);
}

/** Non-mana costs (CR 118): checked before anything is paid, paid together with the rest (CR 601.2h). */
export function checkOtherCosts(g: GameState, player: PlayerId, o: GameObject, cost: Cost, choices: CostChoices = {}): void {
  // Two costs can't both use the same chosen object (Jarad: "Sacrifice a Swamp and a Forest" — two different lands).
  if (new Set(choices.sacrifice ?? []).size !== (choices.sacrifice ?? []).length) throw new RulesError('Choose a different permanent for each sacrifice.');
  if (new Set(choices.discard ?? []).size !== (choices.discard ?? []).length) throw new RulesError('Choose a different card for each discard.');
  const asks = costAsks(g, player, o, cost, choices);
  let next = 0;
  // Cards a random discard will have to find among those not chosen for another discard.
  let atRandom = 0;
  for (const c of cost.other ?? []) {
    const ask = asks[next]?.part === c ? asks[next++] : undefined;
    if (ask?.random) {
      // CR 701.9b: picked as the cost is paid — there must be that many cards it could be, besides the ones chosen for
      // the cost's other discards.
      atRandom += ask.min;
      const given = asks.filter((a) => a.list === 'discard' && !a.random).flatMap((a) => chosenFor(a, choices));
      if (ask.candidates.filter((id) => !given.includes(id)).length < atRandom) throw new RulesError(ask.refusal);
      continue;
    }
    if (ask) {
      checkAsk(g, ask, choices);
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
    } else if (c.type === 'exile_top') {
      // Arc-Slogger: "Exile the top ten cards of your library" — only with that many there (CR 118.3).
      if (zoneList(g, 'library', player).length < Number(c.amount ?? 1)) throw new RulesError('Your library doesn’t have enough cards to exile.');
    } else throw new RulesError(`Paying “${c.type}” isn’t supported yet.`);
  }
  // Nothing chosen beyond what the cost's parts take (a sacrifice or discard nobody asked for is passed over, as ever).
  for (const list of ['exile', 'processed', 'reveal', 'returned', 'crew', 'blighted'] as const) {
    const parts = asks.filter((a) => a.list === list);
    const last = parts[parts.length - 1];
    if (last && (choices[list]?.length ?? 0) > last.at + chosenFor(last, choices).length) throw new RulesError(last.refusal);
  }
}

/**
 * A default way to pay the parts of a cost that take chosen objects — the first candidates, or the ones that cost the
 * player least (tapped permanents returned first, the strongest creatures to crew) — or null if they can't be paid.
 * What the legal-action list fills in; a player is asked (`costAsks`).
 */
export function defaultCostChoices(g: GameState, player: PlayerId, source: GameObject, other: EffectNode[], spare: readonly ObjectId[] = []): CostChoices | null {
  // What the spell or ability targets is taken last: a creature sacrificed to pay for it wouldn't be there to target.
  const sparing = (ids: ObjectId[]): ObjectId[] => (spare.length ? [...ids.filter((id) => !spare.includes(id)), ...ids.filter((id) => spare.includes(id))] : ids);
  const sacrifice: ObjectId[] = [];
  const discard: ObjectId[] = [];
  const crew: ObjectId[] = [];
  const exile: ObjectId[] = [];
  const returned: ObjectId[] = [];
  const reveal: ObjectId[] = [];
  const blighted: ObjectId[] = [];
  const processed: ObjectId[] = [];
  let forageFood = false;
  // "Remove any number of storage counters": all of them, by default.
  let counters: number | undefined;
  const removed: { object: ObjectId; counter: string; n: number }[] = [];
  for (const c of other) {
    const n = Number(c.amount ?? 1);
    if (c.type === 'sacrifice') {
      const pick = sparing(sacrificeCandidates(g, player, c, source)).filter((id) => !sacrifice.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      sacrifice.push(...pick);
    } else if (c.type === 'discard') {
      const pick = discardCandidates(g, player, source, c.filter as ObjectFilter | undefined).filter((id) => !discard.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      discard.push(...pick);
    } else if (c.type === 'collect_evidence') {
      // The biggest cards first, until there's enough.
      const yard = zoneList(g, 'graveyard', player).filter((id) => id !== source.id && !exile.includes(id)).sort((a, b) => manaValueOf(g, g.objects[b]!) - manaValueOf(g, g.objects[a]!));
      let total = 0;
      for (const id of yard) {
        if (total >= n) break;
        exile.push(id);
        total += manaValueOf(g, g.objects[id]!);
      }
      if (total < n) return null;
    } else if (c.type === 'craft') {
      // Cards in the graveyard first, then permanents.
      const pick = craftCandidates(g, player, source, c).filter((id) => !exile.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      exile.push(...pick);
    } else if (c.type === 'exile_cards') {
      const pick = sparing(exileCostCandidates(g, player, source, c)).filter((id) => !exile.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      exile.push(...pick);
    } else if (c.type === 'process') {
      const pick = processCostCandidates(g, player).filter((id) => !processed.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      processed.push(...pick);
    } else if (c.type === 'pay_life' && g.players[player]!.life < lifeCost(g, player, source, c)) return null;
    else if (c.type === 'pay_energy' && (g.players[player]!.counters?.energy ?? 0) < n) return null;
    // CR 701.17b: "Mill a card" as a cost needs a card to mill.
    else if ((c.type === 'mill' || c.type === 'exile_top') && zoneList(g, 'library', player).length < n) return null;
    else if (c.type === 'remove_counters') {
      // The kind asked for; otherwise any counter but loyalty and +1/+1 first (they matter most).
      let left = n;
      const rank = (k: string) => (k === 'loyalty' ? 2 : k === '+1/+1' ? 1 : 0);
      for (const id of counterCostCandidates(g, player, source, c)) {
        const kinds = Object.entries(g.objects[id]!.counters).filter(([k, v]) => (v ?? 0) > 0 && (!c.counter || k === c.counter)).sort((a, b) => rank(a[0]) - rank(b[0]));
        for (const [k, v] of kinds) {
          if (left <= 0) break;
          const used = removed.filter((r) => r.object === id && r.counter === k).reduce((t, r) => t + r.n, 0);
          const take = Math.min(left, (v ?? 0) - used);
          if (take > 0) {
            removed.push({ object: id, counter: k, n: take });
            left -= take;
          }
        }
        if (left <= 0) break;
      }
      if (left > 0) return null;
    } else if (c.type === 'remove_counters_self' && c.amount === 'X') counters = source.counters[String(c.counter)] ?? 0;
    else if (c.type === 'remove_counters_self' && (source.counters[String(c.counter)] ?? 0) < n) return null;
    else if (c.type === 'return_permanents') {
      // Tapped ones first (their mana is already spent).
      const pick = sparing(returnCostCandidates(g, player, source, c))
        .filter((id) => !returned.includes(id))
        .sort((a, b) => Number(g.objects[b]!.tapped) - Number(g.objects[a]!.tapped))
        .slice(0, n);
      if (pick.length < n) return null;
      returned.push(...pick);
    } else if (c.type === 'blight') {
      // The toughest creature (one that survives the counters if it can), not the source of an ability being paid for.
      const options = blightCandidates(g, player).sort((a, b) => toughness(g, g.objects[b]!) - toughness(g, g.objects[a]!));
      const pick = options.find((id) => id !== source.id && !sacrifice.includes(id)) ?? options[0];
      if (!pick) return null;
      blighted.push(pick);
    } else if (c.type === 'forage') {
      // A Food if there is one; otherwise three cards from the graveyard.
      const food = foodCandidates(g, player).find((id) => !sacrifice.includes(id) && id !== source.id);
      if (food) {
        sacrifice.push(food);
        forageFood = true;
      } else {
        const yard = zoneList(g, 'graveyard', player).filter((id) => id !== source.id && !exile.includes(id)).slice(0, 3);
        if (yard.length < 3) return null;
        exile.push(...yard);
      }
    } else if (c.type === 'reveal_from_hand' || c.type === 'behold') {
      const pick = revealCostCandidates(g, player, source, c).filter((id) => !reveal.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      reveal.push(...pick);
    } else if (c.type === 'return_unblocked') {
      const first = unblockedAttackers(g, player)[0];
      if (!first) return null;
      returned.push(first);
    } else if (c.type === 'tap_creatures') {
      // "up to one" (harmonize): the strongest, for the biggest reduction; otherwise what doesn't make mana first.
      const options = tapCostCandidates(g, player, source, c).filter((id) => !crew.includes(id));
      if (c.upTo) options.sort((a, b) => power(g, g.objects[b]!) - power(g, g.objects[a]!));
      else options.sort((a, b) => Number(manaAbilities(g, g.objects[a]!).length > 0) - Number(manaAbilities(g, g.objects[b]!).length > 0));
      const pick = options.slice(0, n);
      if (pick.length < n && !c.upTo) return null;
      crew.push(...pick);
    } else if (c.type === 'station') {
      // The strongest other creature.
      const best = crewCandidates(g, player, source).sort((a, b) => power(g, g.objects[b]!) - power(g, g.objects[a]!))[0];
      if (!best) return null;
      crew.push(best);
    } else if (c.type === 'crew') {
      // The strongest creatures first, until there's enough power.
      const options = crewCandidates(g, player, source).sort((a, b) => crewPower(g, g.objects[b]!) - crewPower(g, g.objects[a]!));
      let total = 0;
      for (const id of options) {
        if (total >= Number(c.power)) break;
        crew.push(id);
        total += crewPower(g, g.objects[id]!);
      }
      if (total < Number(c.power)) return null;
    }
  }
  return { ...(sacrifice.length ? { sacrifice } : {}), ...(discard.length ? { discard } : {}), ...(crew.length ? { crew } : {}), ...(exile.length ? { exile } : {}), ...(returned.length ? { returned } : {}), ...(reveal.length ? { reveal } : {}), ...(blighted.length ? { blighted } : {}), ...(processed.length ? { processed } : {}), ...(forageFood ? { forageFood } : {}), ...(counters !== undefined ? { counters } : {}), ...(removed.length ? { removed } : {}) };
}

/** CR 608.2h: what the chosen sacrifice and discard costs were, before they're paid. */
export function costLKI(g: GameState, player: PlayerId, source: GameObject, cost: Cost, choices: CostChoices = {}): CostLKI | undefined {
  const stats = (id: string) => lkiStats(g, g.objects[id]!);
  const asks = costAsks(g, player, source, cost, choices);
  const of = (type: string, also: (c: EffectNode) => boolean = () => true) => asks.filter((a) => a.part.type === type && also(a.part)).flatMap((a) => chosenFor(a, choices).filter((id) => g.objects[id]));
  const sacrificed = of('sacrifice').map(stats);
  const discarded = of('discard').map(stats);
  const exiled = of('exile_cards', (c) => c.from === 'battlefield').map(stats);
  // Station: "equal to the tapped creature's power" (CR 702.184a).
  const tapped = of('station').map(stats);
  // Ninjutsu, sneak: what the returned creature was attacking.
  const returned = of('return_unblocked')[0];
  const attackTarget = returned ? g.combat?.attackers[returned]?.target : undefined;
  // Molten Hydra: "Remove all +1/+1 counters from this creature" — how many that was.
  const removeAll = (cost.other ?? []).find((c) => c.type === 'remove_counters_self' && c.amount === 'all');
  const countersRemoved = removeAll ? (source.counters[String(removeAll.counter)] ?? 0) : undefined;
  // CR 400.7: in exile each is a new object, one zone change on from where it is now.
  const exiledCards = of('exile_cards').map((id) => ({ id, zcc: g.objects[id]!.zcc + 1 }));
  if (!sacrificed.length && !discarded.length && !exiled.length && !exiledCards.length && !tapped.length && !attackTarget && countersRemoved === undefined) return undefined;
  return {
    ...(countersRemoved !== undefined ? { countersRemoved } : {}),
    ...(exiledCards.length ? { exiledCards } : {}),
    ...(sacrificed.length ? { sacrificed } : {}),
    ...(discarded.length ? { discarded } : {}),
    ...(exiled.length ? { exiled } : {}),
    ...(tapped.length ? { tapped } : {}),
    ...(attackTarget ? { attackTarget: { ...attackTarget } } : {}),
  };
}

export function payOtherCosts(g: GameState, player: PlayerId, o: GameObject, cost: Cost, events: GameEvent[], choices: CostChoices = {}): void {
  const asks = costAsks(g, player, o, cost, choices);
  let next = 0;
  for (const c of cost.other ?? []) {
    const ask = asks[next]?.part === c ? asks[next++] : undefined;
    const chosen = ask ? chosenFor(ask, choices) : [];
    if (c.type === 'sacrifice') {
      // CR 701.21a: each chosen permanent goes to its owner's graveyard.
      for (const id of chosen) {
        events.push({ type: 'sacrificed', object: id, player });
        moveObject(g, id, 'graveyard', events);
      }
    } else if (c.type === 'discard') {
      // CR 701.9a
      for (const id of chosen) discardCard(g, id, events);
    } else if (c.type === 'pay_life') {
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
    } else if (c.type === 'exile_top') {
      for (const id of zoneList(g, 'library', player).slice(0, Number(c.amount ?? 1))) moveObject(g, id, 'exile', events);
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
      for (const id of chosen) moveObject(g, id, 'exile', events);
      events.push({ type: 'evidence_collected', player });
    } else if (c.type === 'craft') {
      moveObject(g, o.id, 'exile', events);
      for (const id of chosen) moveObject(g, id, 'exile', events);
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
      for (const id of chosen) setTapped(g, id, !c.untap, events);
    } else if (c.type === 'return_unblocked' || c.type === 'return_permanents') {
      for (const id of chosen) moveObject(g, id, 'hand', events);
    } else if (c.type === 'exile_cards') {
      // CR 607.2a: what a cost exiles is "exiled with" its source — Fear of Abduction's "each card exiled with it" includes
      // the creature exiled to cast it (the permanent the spell becomes); Corpse Explosion's "damage equal to the exiled
      // card's power" is the creature card exiled from the graveyard to cast it; Necropolis's "where X is the exiled
      // card's mana value", the one exiled to activate it.
      for (const id of chosen) {
        moveObject(g, id, 'exile', events);
        const x = g.objects[id];
        if (x?.zone === 'exile') x.exiledBy = { id: o.id, zcc: linkedZcc(g, o) };
      }
    } else if (c.type === 'process') {
      for (const id of chosen) moveObject(g, id, 'graveyard', events);
    } else if (c.type === 'blight') {
      const target = chosen[0] ? g.objects[chosen[0]] : undefined;
      if (target) blight(g, player, target, Number(c.amount ?? 1), events);
    } else if (c.type === 'forage') {
      if (choices.forageFood) {
        for (const id of chosen) {
          events.push({ type: 'sacrificed', object: id, player });
          moveObject(g, id, 'graveyard', events);
        }
      } else for (const id of chosen) moveObject(g, id, 'exile', events);
      events.push({ type: 'foraged', player });
    } else if (c.type === 'reveal_from_hand' || c.type === 'behold') {
      // CR 701.20a / 701.4a: the cards from the hand are revealed; a beheld permanent is only chosen.
      const shown = chosen.filter((id) => g.objects[id]?.zone === 'hand');
      if (shown.length) events.push({ type: 'revealed', player, objects: shown });
      // Champions of the Perfect: "behold an Elf and exile it" — exiled with the permanent this spell becomes (CR 607.2a).
      if (c.exile) {
        for (const id of chosen) {
          moveObject(g, id, 'exile', events);
          const x = g.objects[id];
          if (x?.zone === 'exile') x.exiledBy = { id: o.id, zcc: linkedZcc(g, o) };
        }
      }
    } else if (c.type === 'discard_self') {
      // CR 701.9a: discarding moves it from its owner's hand to their graveyard.
      discardCard(g, o.id, events);
    }
  }
}

/**
 * CR 605.3a: whether this player may activate this mana ability now, what the parts of its cost take, and how a mana
 * cost of its own will be paid. Only reads the game: `runManaAbility` is this, then the payment and the mana; the
 * legal-action list is this, stopped there.
 *
 * `auto`: for the list — nothing was chosen for its costs: the default for each part that takes objects.
 */
export function manaAbilityWay(g: GameState, player: PlayerId, id: ObjectId, index: number, costChoices: CostChoices = {}, tapForCost = false, auto = false) {
  const o = obj(g, id);
  // CR 602.2: only an object's controller can activate its abilities (its owner, for a card in a hand or graveyard:
  // which abilities work from there is manaAbilities' to say).
  const elsewhere = (o.zone === 'hand' || o.zone === 'graveyard') && o.owner === player;
  if (!elsewhere && (o.zone !== 'battlefield' || o.controller !== player)) throw new RulesError('You don’t control that permanent.');
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
  // Manaforge Cinder: "Activate no more than three times each turn."
  const was = o.activations?.[onceKey];
  const used = was && was.turn === g.turn ? was.n : 0;
  if (ability.maxPerTurn && used >= ability.maxPerTurn) throw new RulesError(`That ability can be activated no more than ${ability.maxPerTurn} times each turn.`);
  if (auto) {
    const picked = defaultCostChoices(g, player, o, ability.cost.other ?? []);
    // (What the part that can't be paid says, where one can't.)
    if (!picked) checkOtherCosts(g, player, o, ability.cost, {});
    costChoices = picked ?? {};
  }
  checkOtherCosts(g, player, o, ability.cost, costChoices);
  const manaCost = ability.cost.mana ? parseManaCost(ability.cost.mana) : null;
  if (manaCost) abilityCostReductions(g, o, ability, manaCost, player);
  // CR 605.3a: the mana for a mana ability's own cost can be made while activating it — from anything but itself.
  const purpose = { kind: 'ability' as const, source: o };
  let payment: PlannedActivation[] = [];
  if (manaCost && tapForCost) {
    const need = shortfall(spendablePool(g, player, purpose), manaCost);
    if (!need || need.specific.length || need.generic > 0) {
      const plan = manaCost.unsupported.length ? null : planManaOnly(g, player, manaCost, 0, [id], purpose);
      if (!plan) throw new RulesError('You don’t have enough untapped mana sources.');
      payment = plan;
    }
  } else if (manaCost && !canPayMana(g, player, manaCost, 0, purpose)) throw new RulesError('Not enough mana in your pool to activate that.');
  return { o, ability, onceKey, used, costChoices, manaCost, payment };
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
  /** Tap other sources for the ability's own mana cost (a Signet's {1}) where the pool doesn't cover it. */
  tapForCost = false,
): void {
  const { o, ability, onceKey, used, manaCost, payment } = manaAbilityWay(g, player, id, index, costChoices, tapForCost);
  if (ability.oncePerTurn) (o.activatedTurn ??= {})[onceKey] = g.turn;
  if (ability.maxPerTurn) (o.activations ??= {})[onceKey] = { turn: g.turn, n: used + 1 };
  runPayment(g, player, payment, events);
  if (manaCost && !payMana(g, player, manaCost, 0, { kind: 'ability', source: o })) {
    throw new RulesError('Not enough mana in your pool to activate that.');
  }
  if (ability.cost.tap) setTapped(g, id, true, events);
  if (ability.cost.untap) setTapped(g, id, false, events);
  // CR 608.2h: "1 plus the exiled creature's mana value" — what the cost moved, as it was.
  const lki = costLKI(g, player, o, ability.cost, costChoices);
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
 *
 * Kinnan, Mirari's Wake: "one additional mana of any type that permanent produced" — a choice only when it made more
 * than one type (a Signet's {G}{U}). `types` is what this activation makes, when that's known.
 */
export function bonusManaChoices(g: GameState, tapped: GameObject, types?: readonly ManaColor[]): (number | ManaColor)[] {
  for (const { src, a } of manaTriggersOf(g, tapped)) {
    if (a.trigger.producedColor) continue;
    if (a.effects.some((x) => (x as AddManaEffect).produced)) {
      const made = [...new Set(types ?? [])];
      if (made.length > 1) return made;
      continue;
    }
    const e = a.effects.find((x) => bonusChoice(x as AddManaEffect)) as AddManaEffect | undefined;
    if (!e) continue;
    if (e.anyColor) return anyColorChoices(g, a.trigger.its ? tapped.controller : src.controller, e.identity, e, src);
    return (e.options ?? []).map((_, i) => i);
  }
  return [];
}

/** Whether tapping this permanent for mana triggers anything that adds mana (Kinnan, Mirari's Wake, Fertile Ground). */
export function manaTriggered(g: GameState, tapped: GameObject): boolean {
  return manaTriggersOf(g, tapped).some(({ a }) => a.effects.every((x) => x.type === 'add_mana'));
}

/** Whether a permanent being tapped for mana triggers anything that adds mana by a choice (see `bonusManaChoices`). */
export function manaBonusAsks(g: GameState, tapped: GameObject): boolean {
  return manaTriggersOf(g, tapped).some(({ a }) => !a.trigger.producedColor && a.effects.some((x) => (x as AddManaEffect).produced || bonusChoice(x as AddManaEffect)));
}

function tappedForMana(g: GameState, tapped: GameObject, produced: ManaColor[], events: GameEvent[], bonus: readonly (number | ManaColor)[] = []): void {
  const first = events.length;
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
      let run = effect;
      if (effect.type === 'add_mana' && (effect as AddManaEffect).produced) {
        // "one mana of any type that permanent produced": of the types it made, the one the action named — the first
        // otherwise (tapped automatically, or there was only one).
        const made = [...new Set(produced)];
        const named = made.length > 1 ? bonus[asked++] : undefined;
        run = { type: 'add_mana', options: [[typeof named === 'string' && made.includes(named) ? named : made[0]!]] };
      }
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
  // What these added is on top of what the permanent made (the log says so).
  for (let i = first; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'mana_added') e.triggered = true;
  }
}

/** CR 601.2g: activates mana abilities automatically to cover a cost beyond what's in the pool. */
export function autoTap(g: GameState, player: PlayerId, cost: ManaCost, x: number, events: GameEvent[], exclude: ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): void {
  // The cost's Phyrexian symbols were settled already (settlePhyrexian): what's left is paid with mana, never unasked-for life.
  const plan = planManaOnly(g, player, cost, x, exclude, purpose);
  if (!plan) throw new RulesError('You don’t have enough untapped mana sources.');
  runPayment(g, player, plan, events);
}

/** Activates the mana abilities a payment was planned with (planManaOnly), in order. */
export function runPayment(g: GameState, player: PlayerId, plan: readonly PlannedActivation[], events: GameEvent[]): void {
  for (const step of plan) runManaAbility(g, player, step.object, step.ability, step.choice, events, {}, step.bonus ?? []);
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
  // CR 107.4f: Phyrexian symbols (Norn's Annex's "{W/P}") — mana when it can be paid, else 2 life each.
  const life = cost.phyrexian.length ? settlePhyrexian(g, player, cost, undefined, x, true) : 0;
  const ps = g.players[player]!;
  if (life && ps.life < life) throw new RulesError(`You can’t pay ${mana}.`);
  if (!payFromPool(spendablePool(g, player, OTHER_PURPOSE), cost, x)) autoTap(g, player, cost, x, events);
  if (!payMana(g, player, cost, x, OTHER_PURPOSE)) throw new RulesError(`You can’t pay ${mana}.`);
  if (life) {
    const lost = lifeLoss(g, player, life);
    ps.life -= lost;
    events.push({ type: 'life', player, delta: -lost, life: ps.life });
  }
}

/** Processors' costs: cards in exile an opponent of `player` owns. */
export function processCostCandidates(g: GameState, player: PlayerId): ObjectId[] {
  return g.zones.exile.filter((id) => g.objects[id]!.owner !== player && g.players[g.objects[id]!.owner] !== undefined);
}
