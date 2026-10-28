import { activationProhibited, castProhibition } from './cast-bans.js';
import { drawOrDredge } from './dredge.js';
import { unlockHalf } from './rooms.js';
import { untapStep } from './flow.js';
import { STEPS } from './types.js';
import { abilitySources, livePlayers } from './zones.js';
import { auraTargetSpec } from './permanents.js';
import { payWithHelpers } from './helpers-cost.js';
import { ensureFaceDownDefs, faceDownFace, FACE_DOWN_KEYWORDS } from './face-down.js';
import type { ActivatedAbility, Amount, ConditionNode, Cost, EffectNode, FaceDef, CastOptionNode, ObjectFilter, SpellAbility } from '@mtg/schema';
import { amountOf } from './resolve.js';
import { assignCombatDamage, declareAttackers, declareBlockers, promptNextBlocker } from './combat.js';
import { canActivateTapAbilities, isPermanentCard, manaAbilities } from './characteristics.js';
import { grantedKeywordOff, hasKeyword, matchesFilter, objectAbilities, power, printedAbilities } from './characteristics.js';
import { evalCondition } from './conditions.js';
import {
  checkStateBasedActions,
  completeManualResolution,
  continueResolution,
  finishCleanup,
  givePriority,
  passPriority,
  playerLoses,
  settle,
} from './flow.js';
import { reduceCostBy, parseManaCost, type ManaCost } from './mana.js';
import { lastSpentRestricted, OTHER_PURPOSE, payMana, type ManaPurpose } from './spending.js';
const UNLOCK: ManaPurpose = { kind: 'unlock' };
const FACE_UP: ManaPurpose = { kind: 'face_up' };
import { autoTap, checkOtherCosts, costLKI, payOtherCosts, runManaAbility } from './payment.js';
import { appendProgram, activatedAbilities, flatten, spellPrograms } from './program.js';
import { answerOpening } from './setup.js';
import { chooseTargets, divisionFor } from './targets.js';
import { announceTargets, answerTriggerTargets } from './triggers.js';
import {
  RulesError,
  type Action,
  type ApplyResult,
  type ChoiceAnswer,
  type CompiledProgram,
  type CostChoices,
  type GameEvent,
  type GameObject,
  type GameState,
  type ManaColor,
  type ManaMix,
  type ManualOp,
  type ObjectId,
  type PlayerId,
  type Target,
  type TargetRef,
} from './types.js';
import { flashPermission, landsAllowed, playerRule } from './player-rules.js';
import { preparedSource, unprepare } from './prepare.js';
import { bestowedFace, manaValueOf } from './zones.js';
import { answerAsEnters } from './as-enters.js';
import { applyCostModifiers } from './costs.js';
import { freePermission, mayPlayFrom, topLifeOnly } from './permissions.js';
import { drawCard, faceOf, moveObject, nameOf, obj, setTapped, zoneList, discardCard } from './zones.js';

/**
 * Applies one player action. Pure: the input state is never modified.
 * CR 733.1: an illegal action is reversed entirely — here, by returning an error
 * and leaving the original state untouched.
 */
export function apply(state: GameState, action: Action): ApplyResult {
  // Card definitions never change during a game (new tokens only add entries), so they're
  // shared between states rather than copied each action.
  const { cards, ...rest } = state;
  const g: GameState = { ...structuredClone(rest), cards: { ...cards } };
  const events: GameEvent[] = [];
  try {
    handle(g, action, events);
    settle(g, events);
    return { ok: true, state: g, events };
  } catch (err) {
    if (err instanceof RulesError) return { ok: false, error: err.message };
    throw err;
  }
}

function handle(g: GameState, a: Action, events: GameEvent[]): void {
  if (g.over) throw new RulesError('The game is over.');
  if (!g.players[a.player] || g.players[a.player]!.lost) throw new RulesError('That player is not in the game.');

  switch (a.type) {
    case 'concede':
      // CR 104.3a: a player can concede at any time.
      playerLoses(g, a.player, 'conceded', events);
      return;
    case 'choose':
      return choose(g, a.player, a.answer, events);
    case 'activate_mana':
      return activateMana(g, a.player, a.object, a.ability, a.choice, events, a.costs);
    case 'manual':
      return manual(g, a.player, a.op, events);
  }

  if (g.pending) throw new RulesError(`Waiting for ${g.players[g.pending.player]!.name} to choose (${g.pending.kind}).`);
  if (g.priority !== a.player) throw new RulesError('You don’t have priority.');

  // CR 702.61a: while a spell with split second is on the stack, players can't cast spells or activate non-mana abilities.
  if ((a.type === 'cast' || a.type === 'activate') && splitSecond(g)) throw new RulesError('A spell with split second is on the stack.');
  switch (a.type) {
    case 'pass':
      return passPriority(g, a.player, events);
    case 'play_land':
      return playLand(g, a.player, a.object, a.face ?? 0, events);
    case 'turn_face_up':
      return turnFaceUp(g, a.player, a.object, a.autoTap ?? false, events);
    case 'unlock':
      return unlockDoor(g, a.player, a.object, a.half, a.autoTap ?? false, events);
    case 'foretell':
    case 'plot':
    case 'suspend':
      return exileToCastLater(g, a.player, a.object, a.type, a.autoTap ?? false, events);
    case 'cast':
      return cast(g, a.player, a.object, a.face ?? 0, a.x ?? 0, a.autoTap ?? false, a.targets, a.modes, events, a.costs ?? {}, a.kicked ?? false, a.alt, a.extras ?? [], undefined, a.divide);
    case 'activate':
      return activate(g, a.player, a.object, a.ability, { x: a.x ?? 0, autoTap: a.autoTap ?? false, targets: a.targets, modes: a.modes, costs: a.costs ?? {}, divide: a.divide }, events);
    case 'activate_manual':
      return activateManual(g, a.player, a.object, a.line, a.autoTap ?? false, events);
  }
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

function choose(g: GameState, player: PlayerId, answer: ChoiceAnswer, events: GameEvent[]): void {
  const p = g.pending;
  if (!p || p.player !== player) throw new RulesError('You have no choice to make.');
  if (p.kind !== answer.kind) throw new RulesError(`Expected a ${p.kind} answer.`);

  switch (answer.kind) {
    case 'mulligan':
    case 'bottom_cards':
    case 'opening_battlefield':
      answerOpening(g, player, answer, events);
      return;
    case 'discard_to_hand_size': {
      const count = (p as Extract<typeof p, { kind: 'discard_to_hand_size' }>).count;
      const ids = answer.objects;
      const hand = zoneList(g, 'hand', player);
      if (ids.length !== count || new Set(ids).size !== ids.length || !ids.every((id) => hand.includes(id))) {
        throw new RulesError(`Choose exactly ${count} card(s) from your hand to discard.`);
      }
      g.pending = null;
      // CR 514.1: the active player discards down to their maximum hand size.
      for (const id of ids) discardCard(g, id, events);
      finishCleanup(g, events);
      return;
    }
    case 'dredge': {
      const candidates = (p as Extract<typeof p, { kind: 'dredge' }>).candidates;
      if (answer.object !== null && !candidates.includes(answer.object)) throw new RulesError('Choose a card with dredge in your graveyard, or draw.');
      g.pending = null;
      drawOrDredge(g, player, answer.object, events);
      givePriority(g, g.active);
      return;
    }
    case 'keep_tapped': {
      const candidates = (p as Extract<typeof p, { kind: 'keep_tapped' }>).candidates;
      if (new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
        throw new RulesError('Choose permanents you may leave tapped.');
      }
      g.pending = null;
      untapStep(g, events, answer.objects);
      return;
    }
    case 'legend_rule': {
      const objects = (p as Extract<typeof p, { kind: 'legend_rule' }>).objects;
      if (!objects.includes(answer.keep)) throw new RulesError('Choose one of the legendary permanents to keep.');
      g.pending = null;
      // CR 704.5j: the rest go to their owners' graveyards.
      for (const id of objects) if (id !== answer.keep) moveObject(g, id, 'graveyard', events);
      if (g.step === 'cleanup' && g.priority === null) {
        checkStateBasedActions(g, events);
        if (!g.pending && !g.over) {
          g.extraCleanup = true;
          givePriority(g, g.active);
        }
      }
      return;
    }
    case 'manual_resolution':
      completeManualResolution(g, events);
      return;
    case 'declare_attackers':
      g.pending = null;
      declareAttackers(g, answer.attacks, events, answer.exert ?? [], answer.enlist ?? []);
      // CR 508.2: then the active player gets priority.
      givePriority(g, g.active);
      return;
    case 'declare_blockers':
      declareBlockers(g, player, answer.blocks, events);
      promptNextBlocker(g, events);
      // CR 509.2: once blockers are declared, the active player gets priority.
      if (!g.pending) givePriority(g, g.active);
      return;
    case 'assign_combat_damage':
      assignCombatDamage(g, answer.assignments, events);
      // CR 510.3: then (once every player has assigned theirs) the active player gets priority.
      if (!g.pending) givePriority(g, g.active);
      return;
    case 'trigger_targets':
      answerTriggerTargets(g, player, answer.modes, answer.targets, events);
      return;
    case 'as_enters':
      answerAsEnters(g, player, answer, events);
      return;
    case 'scry':
    case 'surveil':
    case 'discard':
    case 'may':
    case 'pay':
    case 'search':
    case 'sacrifice':
    case 'proliferate':
    case 'choose_objects':
    case 'choose_option':
    case 'copy_targets':
    case 'cast_free':
      // A choice made while a spell or ability resolves: carry on resolving with it.
      if (!g.resolving) throw new RulesError('Nothing is resolving.');
      g.pending = null;
      continueResolution(g, events, answer);
      return;
  }
}

// ---------------------------------------------------------------------------
// Lands
// ---------------------------------------------------------------------------

/** CR 702.61a: whether a spell with split second is on the stack. */
export function splitSecond(g: GameState): boolean {
  return g.stack.some((e) => e.kind === 'spell' && g.objects[e.object] && hasKeyword(g, g.objects[e.object]!, 'split_second'));
}

/** The mana a special action from hand costs: foretell {2}, plot and suspend their own cost. */
export function exileActionCost(face: FaceDef, kind: 'foretell' | 'plot' | 'suspend'): string | null {
  const kw = face.keywords.find((k) => k.id === kind && k.cost && /^(\{[^}]+\})+$/.test(k.cost) && (kind !== 'suspend' || k.n));
  if (!kw) return null;
  return kind === 'foretell' ? '{2}' : kw.cost!;
}

/** Whether the special action is allowed now (CR 702.143a: your turn; 702.170a: main phase, empty stack; 702.62a: when you could cast it). */
export function exileActionTiming(g: GameState, player: PlayerId, face: FaceDef, kind: 'foretell' | 'plot' | 'suspend'): boolean {
  const sorcery = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;
  if (kind === 'foretell') return g.active === player;
  if (kind === 'plot') return sorcery;
  const instant = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash') || playerRule(g, player, 'flash') > 0;
  return instant || sorcery;
}

/** Foretell, plot, suspend: special actions that exile a card from your hand to cast it later (CR 116.2). */
function exileToCastLater(g: GameState, player: PlayerId, id: ObjectId, kind: 'foretell' | 'plot' | 'suspend', wantsAutoTap: boolean, events: GameEvent[]): void {
  const o = obj(g, id);
  if (o.zone !== 'hand' || o.owner !== player) throw new RulesError(`You can only ${kind} a card from your hand.`);
  const face = faceOf(g, o);
  const costText = exileActionCost(face, kind);
  if (!costText) throw new RulesError(`${face.name} can’t be ${kind === 'suspend' ? 'suspended' : `${kind}ted`.replace('tt', 't')}.`);
  if (!exileActionTiming(g, player, face, kind)) throw new RulesError(`You can’t ${kind} ${face.name} now.`);
  const cost = parseManaCost(costText);
  if (wantsAutoTap) autoTap(g, player, cost, 0, events);
  if (!payMana(g, player, cost, 0, OTHER_PURPOSE)) throw new RulesError(`Not enough mana to pay ${costText}.`);
  moveObject(g, id, 'exile', events);
  if (kind === 'foretell') o.foretold = g.turn;
  if (kind === 'plot') o.plotted = g.turn;
  if (kind === 'suspend') {
    // CR 702.62a: with N time counters.
    o.suspended = true;
    o.counters.time = face.keywords.find((k) => k.id === 'suspend')!.n!;
  }
  // CR 116.3: a player who takes a special action receives priority afterward.
  givePriority(g, player);
}

/** CR 709.5e: pay the mana cost of a locked door — a special action, at sorcery timing. */
function unlockDoor(g: GameState, player: PlayerId, id: ObjectId, half: 0 | 1, wantsAutoTap: boolean, events: GameEvent[]): void {
  const o = obj(g, id);
  if (o.zone !== 'battlefield' || o.controller !== player || !o.unlocked) throw new RulesError('You can only unlock a Room you control.');
  if (o.unlocked[half]) throw new RulesError('That door is already unlocked.');
  if (g.active !== player || (g.step !== 'main1' && g.step !== 'main2') || g.stack.length > 0) throw new RulesError('Doors can be unlocked only during your main phase while the stack is empty.');
  const cost = parseManaCost(g.cards[o.card]!.faces[half]!.manaCost);
  if (cost.unsupported.length || cost.x) throw new RulesError('That unlock cost isn’t supported yet.');
  if (wantsAutoTap) autoTap(g, player, cost, 0, events, [], UNLOCK);
  if (!payMana(g, player, cost, 0, UNLOCK)) throw new RulesError('Not enough mana to unlock that door.');
  unlockHalf(g, o, half, events);
  // CR 116.3: a player who takes a special action receives priority afterward.
  givePriority(g, player);
}

/** CR 702.37e / 116.2b: turn a face-down permanent you control face up — a special action. */
function turnFaceUp(g: GameState, player: PlayerId, id: ObjectId, wantsAutoTap: boolean, events: GameEvent[]): void {
  const o = obj(g, id);
  if (!o.faceDown || o.zone !== 'battlefield' || o.controller !== player) throw new RulesError('You can only turn a face-down permanent you control face up.');
  const costText = faceUpCost(g, o);
  if (!costText) throw new RulesError('That can’t be turned face up.');
  const cost = parseManaCost(costText);
  if (cost.unsupported.length || cost.x) throw new RulesError(`Paying ${costText} isn’t supported yet.`);
  if (wantsAutoTap) autoTap(g, player, cost, 0, events, [], FACE_UP);
  if (!payMana(g, player, cost, 0, FACE_UP)) throw new RulesError(`Not enough mana to pay ${costText}.`);
  const face = g.cards[o.card]!.faces[o.face] ?? g.cards[o.card]!.faces[0]!;
  // CR 708.8: it's the same permanent, now with its own characteristics; nothing about entering happens.
  delete o.faceDown;
  // CR 702.37b: megamorph — a +1/+1 counter as it's turned face up.
  if (face.keywords.some((k) => k.id === 'megamorph')) o.counters['+1/+1'] = (o.counters['+1/+1'] ?? 0) + 1;
  events.push({ type: 'turned_face_up', object: id });
  // CR 116.3: a player who takes a special action receives priority afterward.
  givePriority(g, player);
}

function playLand(g: GameState, player: PlayerId, id: ObjectId, faceIndex: number, events: GameEvent[]): void {
  const o = obj(g, id);
  const def = g.cards[o.card]!;
  const face = def.faces[faceIndex];
  if (!face) throw new RulesError('That card has no such face.');
  const fromExile = (o.zone === 'exile' || o.zone === 'library' || o.zone === 'graveyard') && mayPlayFrom(g, player, o, 'land');
  // "You may play lands from your graveyard."
  const fromGraveyard = o.zone === 'graveyard' && o.owner === player && playerRule(g, player, 'lands_from_graveyard');
  if (!fromExile && !fromGraveyard && (o.zone !== 'hand' || o.owner !== player)) throw new RulesError('You can only play lands from your hand.');
  if (!face.types.includes('Land')) throw new RulesError(`${face.name} isn’t a land.`);
  // CR 712.12: a modal double-faced card is played as a land with a land face up.
  if (faceIndex > 0 && def.layout !== 'modal_dfc') throw new RulesError('Only modal double-faced cards can be played back face up.');
  // CR 305.1: during your main phase, with the stack empty.
  if (g.active !== player) throw new RulesError('You can only play lands during your own turn.');
  if (g.step !== 'main1' && g.step !== 'main2') throw new RulesError('Lands can only be played during a main phase.');
  if (g.stack.length > 0) throw new RulesError('Lands can only be played while the stack is empty.');
  // CR 305.2: normally one land per turn; continuous effects may allow more (CR 305.2a).
  if (g.players[player]!.landsPlayedThisTurn >= landsAllowed(g, player)) throw new RulesError('You’ve already played a land this turn.');

  g.players[player]!.landsPlayedThisTurn++;
  // CR 116.2a: playing a land is a special action — it goes straight onto the battlefield.
  moveObject(g, id, 'battlefield', events, { controller: player, face: faceIndex });
  events.push({ type: 'land_played', player, object: id });
  // CR 116.3: a player who takes a special action receives priority afterward.
  givePriority(g, player);
}

// ---------------------------------------------------------------------------
// Mana abilities
// ---------------------------------------------------------------------------

function activateMana(
  g: GameState,
  player: PlayerId,
  id: ObjectId,
  index: number,
  choice: number | ManaColor | ManaMix | undefined,
  events: GameEvent[],
  costs: CostChoices = {},
): void {
  // CR 605.3a: mana abilities can be activated with priority, or while something asks for a mana payment.
  const paying = (g.pending?.kind === 'manual_resolution' || g.pending?.kind === 'pay') && g.pending.player === player;
  // Lion's Eye Diamond: "Activate only as an instant" — with priority, not in the middle of a payment.
  const ab = g.objects[id] ? manaAbilities(g, g.objects[id]!)[index] : undefined;
  if (paying && ab?.timing === 'instant') throw new RulesError('That ability can be activated only as an instant.');
  if (!paying) {
    if (g.pending) throw new RulesError(`Waiting for ${g.players[g.pending.player]!.name} to choose.`);
    if (g.priority !== player) throw new RulesError('You don’t have priority.');
  }
  runManaAbility(g, player, id, index, choice, events, costs);
  // CR 117.3c: a player who activates an ability receives priority afterward.
  if (!paying) givePriority(g, player);
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

/** Layouts whose non-front faces can be cast. */
const CASTABLE_ALT_FACES = new Set(['split', 'modal_dfc', 'adventure']);

/**
 * What a spell will do and target. Instants and sorceries whose every line compiled run
 * automatically; an Aura targets what it can enchant (CR 303.4a). Anything else is resolved by hand.
 */
function spellProgram(face: FaceDef, modes: number[] | undefined, holds?: (c: ConditionNode) => boolean, allModes = false): CompiledProgram | null {
  if (isPermanentCard(face)) {
    const aura = auraTargetSpec(face);
    if (modes?.length) throw new RulesError(`${face.name} isn’t modal.`);
    return aura ? { specs: [aura], effects: [] } : null;
  }
  const programs = spellPrograms(face);
  if (!programs) {
    if (modes?.length) throw new RulesError(`${face.name} is resolved by hand; choose its modes as it resolves.`);
    return null;
  }
  return flatten(programs, modes, holds, allModes);
}

function addCost(into: ManaCost, extra: ManaCost): void {
  into.generic += extra.generic;
  into.x += extra.x;
  into.hybrid.push(...extra.hybrid);
  into.unsupported.push(...extra.unsupported);
  for (const [c, n] of Object.entries(extra.specific)) into.specific[c as ManaColor] = (into.specific[c as ManaColor] ?? 0) + (n ?? 0);
}

/** Whether casting it means choosing one of a list of additional costs (CR 118.8). */
export const hasCostChoice = (face: FaceDef) => face.abilities.some((a) => a.kind === 'static' && a.effect.type === 'additional_cost_choice');

/** A face's additional costs to cast (CR 601.2f), from its "As an additional cost…" lines. */
export function additionalCosts(face: FaceDef): EffectNode[] {
  return face.abilities.flatMap((a) => (a.kind === 'static' && a.effect.type === 'additional_cost' ? [a.effect.cost as EffectNode] : []));
}

/** castOptions, plus what the player has from elsewhere: Omniscience's "without paying their mana costs" from the hand. */
/**
 * Terror of the Peaks (CR 601.2f): the life a spell's targets add to its cost — each targeted permanent an opponent of the
 * caster controls with "Spells your opponents cast that target this creature cost an additional N life to cast".
 */
export function targetLifeTax(g: GameState, player: PlayerId, targets: readonly (readonly (TargetRef | Target)[])[]): number {
  let n = 0;
  const seen = new Set<string>();
  for (const list of targets) {
    for (const t of list) {
      const id = t.kind === 'object' ? ('id' in t ? t.id : (t as { object: string }).object) : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const o = g.objects[id];
      if (!o || o.zone !== 'battlefield' || o.controller === player) continue;
      for (const a of objectAbilities(g, o)) if (a.kind === 'static' && a.effect.type === 'target_life_tax') n += Number(a.effect.life ?? 0);
    }
  }
  return n;
}

export function castOptionsFor(g: GameState, player: PlayerId, o: GameObject, face: FaceDef): CastOptionNode[] {
  const base = castOptions(face);
  // Underworld Breach: "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost
  // plus exile three other cards from your graveyard." (CR 702.138a)
  if (o.zone === 'graveyard' && o.owner === player && !face.types.includes('Land') && !base.some((x) => x.id === 'escape')) {
    for (const id of abilitySources(g)) {
      const src = g.objects[id]!;
      if (src.controller !== player) continue;
      const grant = objectAbilities(g, src).find((a) => a.kind === 'static' && a.effect.type === 'grant_escape');
      if (grant?.kind !== 'static') continue;
      const filter = (grant.effect.filter ?? {}) as ObjectFilter;
      if (!matchesFilter(g, o, filter, { controller: player, source: src, anyZone: true })) continue;
      base.push({ type: 'cast_option', id: 'escape', kind: 'alternative', zone: 'graveyard', cost: { mana: face.manaCost, other: [{ type: 'exile_cards', amount: Number(grant.effect.exile ?? 0), other: true }] } });
      break;
    }
  }
  // Six: "During your turn, nonland permanent cards in your graveyard have retrace." (CR 702.81a)
  if (o.zone === 'graveyard' && o.owner === player && !face.types.includes('Land') && !base.some((x) => x.id === 'retrace')) {
    for (const id of abilitySources(g)) {
      const src = g.objects[id]!;
      if (src.controller !== player) continue;
      const grant = objectAbilities(g, src).find(
        (a) => a.kind === 'static' && a.effect.type === 'grant_retrace' && (!a.effect.yourTurn || g.active === player) && matchesFilter(g, o, (a.effect.filter ?? {}) as ObjectFilter, { controller: player, source: src, anyZone: true }),
      );
      if (!grant) continue;
      base.push({ type: 'cast_option', id: 'retrace', kind: 'alternative', zone: 'graveyard', withManaCost: true, cost: { other: [{ type: 'discard', amount: 1, filter: { types: ['Land'] } }] } });
      break;
    }
  }
  if (o.zone === 'hand' && !face.types.includes('Land') && playerRule(g, player, 'free_from_hand')) return [...base, { type: 'cast_option', id: 'free', kind: 'alternative', cost: {} }];
  return base;
}

/** CR 118.9 / 601.2f: the alternative and optional additional costs a face offers as it's cast. */
export function castOptions(face: FaceDef): CastOptionNode[] {
  const out = printedAbilities(face).flatMap((a) => (a.kind === 'static' && a.effect.type === 'cast_option' ? [a.effect as CastOptionNode] : []));
  // CR 118.8: "As an additional cost to cast this spell, sacrifice a creature or pay {3}" — one of them, announced (CR 601.2b).
  for (const a of face.abilities) {
    if (a.kind !== 'static' || a.effect.type !== 'additional_cost_choice') continue;
    (a.effect.options as Cost[]).forEach((cost, i) => out.push({ type: 'cast_option', id: `choice${i + 1}`, kind: 'additional', cost, required: true }));
  }
  // Casting from exile: foretell (its foretell cost, CR 702.143a), plot (free, CR 702.170d), madness (CR 702.35a).
  for (const kw of face.keywords) {
    const mana = kw.cost && /^(\{[^}]+\})+$/.test(kw.cost) ? kw.cost : null;
    if (!mana) continue;
    if (kw.id === 'foretell') out.push({ type: 'cast_option', id: 'foretell', kind: 'alternative', cost: { mana }, zone: 'exile' });
    if (kw.id === 'plot') out.push({ type: 'cast_option', id: 'plot', kind: 'alternative', cost: {}, zone: 'exile' });
    if (kw.id === 'madness') out.push({ type: 'cast_option', id: 'madness', kind: 'alternative', cost: { mana }, zone: 'exile' });
    // CR 702.103a: "As you cast this spell, you may choose to cast it bestowed. If you do, you pay [cost] rather than its mana cost."
    if (kw.id === 'bestow') out.push({ type: 'cast_option', id: 'bestow', kind: 'alternative', cost: { mana } });
    // CR 702.94a: miracle — only as its triggered ability resolves.
    if (kw.id === 'miracle') out.push({ type: 'cast_option', id: 'miracle', kind: 'alternative', cost: { mana }, duringResolution: true });
    // CR 702.119a: emerge — pay [cost] and sacrifice a creature; its mana value comes off the generic part.
    if (kw.id === 'emerge') out.push({ type: 'cast_option', id: 'emerge', kind: 'alternative', cost: { mana, other: [{ type: 'sacrifice', filter: { types: ['Creature'] }, amount: 1 }] }, reduceBySacrificed: true });
    // CR 702.180a: harmonize — from your graveyard, paying [cost] and tapping up to one untapped creature you control
    // (its power comes off the generic part); exiled instead of going anywhere else as it leaves the stack.
    if (kw.id === 'harmonize') {
      out.push({
        type: 'cast_option', id: 'harmonize', kind: 'alternative', zone: 'graveyard', exileOnLeave: true, reduceByTappedPower: true,
        cost: { mana, other: [{ type: 'tap_creatures', amount: 1, upTo: true, filter: { types: ['Creature'], controller: 'you' } }] },
      });
    }
    // CR 702.190a: sneak — pay [cost] and return an unblocked creature you control rather than the mana cost.
    if (kw.id === 'sneak') out.push({ type: 'cast_option', id: 'sneak', kind: 'alternative', cost: { mana, other: [{ type: 'return_unblocked' }] } });
  }
  // CR 702.37a / 702.168a: morph, megamorph and disguise cast it face down for {3}.
  for (const kw of face.keywords) {
    if ((FACE_DOWN_KEYWORDS as readonly string[]).includes(kw.id) && kw.cost && /^(\{[^}]+\})+$/.test(kw.cost)) {
      out.push({ type: 'cast_option', id: kw.id, kind: 'alternative', cost: { mana: '{3}' } });
    }
  }
  return out;
}

/** CR 702.37e / 701.40b: the cost to turn a face-down permanent face up, or null if it can't be. */
export function faceUpCost(g: GameState, o: GameObject): string | null {
  const face = g.cards[o.card]!.faces[o.face] ?? g.cards[o.card]!.faces[0]!;
  const kw = face.keywords.find((k) => (FACE_DOWN_KEYWORDS as readonly string[]).includes(k.id) && k.cost && /^(\{[^}]+\})+$/.test(k.cost));
  if (kw) return kw.cost!;
  // A manifested or cloaked creature card: its mana cost.
  if ((o.faceDown === 'manifest' || o.faceDown === 'cloak') && face.types.includes('Creature') && face.manaCost) return face.manaCost;
  return null;
}

/** The flashback cost, if the face has flashback with a mana cost the engine can pay. */
export function flashbackCost(face: FaceDef): string | null {
  const kw = face.keywords.find((k) => k.id === 'flashback');
  return kw?.cost && /^(\{[^}]+\})+$/.test(kw.cost) ? kw.cost : null;
}

/** CR 702.34a: its flashback cost, printed or given by an effect (Snapcaster Mage, Past in Flames, Lier). */
export function flashbackCostOf(g: GameState, o: GameObject, face: FaceDef): string | null {
  const own = flashbackCost(face);
  if (own) return own;
  const k = grantedKeywordOff(g, o, 'flashback');
  const cost = k ? (k.costIsManaCost ? face.manaCost : k.cost) : undefined;
  return cost && /^(\{[^}]+\})+$/.test(cost) ? cost : null;
}

function cast(
  g: GameState,
  player: PlayerId,
  id: ObjectId,
  faceIndex: number,
  x: number,
  wantsAutoTap: boolean,
  chosenTargets: Target[][] | undefined,
  modes: number[] | undefined,
  events: GameEvent[],
  costChoices: CostChoices,
  kickedArg: boolean | number,
  altId?: string,
  extras: string[] = [],
  /** CR 608.2g: cast while an effect resolves ("you may cast it without paying its mana cost", madness). */
  during?: { free?: boolean; suspended?: true; exileOnLeave?: true },
  divide?: number[],
): void {
  const kicks = typeof kickedArg === 'number' ? Math.max(0, Math.floor(kickedArg)) : kickedArg ? 1 : 0;
  const kicked = kicks > 0;
  const o = obj(g, id);
  // CR 722.3c: a prepare spell's copy in exile is cast as its prepare spell, by the prepared permanent's controller.
  const prepared = o.prepareOf ? preparedSource(g, o, player) : undefined;
  if (o.prepareOf) {
    if (!prepared) throw new RulesError('That prepare spell can’t be cast now.');
    faceIndex = 1;
  }
  const def = g.cards[o.card]!;
  const face = def.faces[faceIndex];
  if (!face) throw new RulesError('That card has no such face.');
  // CR 118.9 / 601.2b: an alternative cost and optional additional costs, announced as it's cast.
  const options = castOptionsFor(g, player, o, face);
  const alt = altId ? options.find((x) => x.kind === 'alternative' && x.id === altId) : undefined;
  if (altId && !alt) throw new RulesError(`${face.name} has no “${altId}” cost.`);
  const added = extras.map((x) => {
    const opt = options.find((y) => y.kind === 'additional' && y.id === x);
    if (!opt) throw new RulesError(`${face.name} has no optional “${x}” cost.`);
    return opt;
  });
  // CR 118.8 / 601.2b: one of a list of additional costs ("sacrifice a creature or pay {3}") must be chosen.
  if (options.some((y) => y.required) && added.filter((a) => a.required).length !== 1) throw new RulesError(`Choose which of ${face.name}’s additional costs to pay.`);
  // Replicate and squad may be paid any number of times (CR 702.56a, 702.157a); others once.
  if (extras.some((x, i) => extras.indexOf(x) !== i && !options.find((y) => y.id === x)?.repeatable)) throw new RulesError('Each optional cost can be paid once.');
  if (alt?.duringResolution && !during) throw new RulesError(`${face.name}'s ${alt.id} cost can be paid only as its ability resolves.`);
  if (alt?.condition && !evalCondition(alt.condition, { g, controller: player, source: o, events: [], targets: [], x, memo: {} })) {
    throw new RulesError(`${face.name} can’t be cast for that cost now.`);
  }
  // CR 702.37c / 702.168b: cast face down, it's a 2/2 creature spell with no text (CR 708.4).
  const faceDown = alt && (FACE_DOWN_KEYWORDS as readonly string[]).includes(alt.id) ? (alt.id === 'disguise' ? 'disguise' : 'morph') : undefined;
  // CR 702.146a (disturb): cast transformed — the back face is the spell (CR 712.11a).
  if (alt?.transformed) {
    if (def.faces.length < 2) throw new RulesError(`${face.name} has no back face.`);
    faceIndex = 1;
  }
  const castFace = faceDown
    ? faceDownFace({ ...o, faceDown })
    : alt?.id === 'bestow'
      ? bestowedFace(face)
      : alt?.transformed
      ? def.faces[1]!
      : alt?.spell
        ? // CR 702.96b (overload): "target" becomes "each".
          { ...face, abilities: [...face.abilities.filter((a) => a.kind !== 'spell'), alt.spell] }
        : face;
  // CR 702.42a: entwine chooses every mode.
  if (added.some((a) => a.allModes)) {
    const modal = face.abilities.find((a): a is SpellAbility => a.kind === 'spell' && Boolean(a.modes));
    const n = modal?.modes?.options.length ?? 0;
    modes = Array.from({ length: n }, (_, i) => i);
  }
  // CR 903.8: a player may cast a commander they own from the command zone.
  const fromCommandZone = o.zone === 'command' && o.commander === true && o.owner === player;
  // CR 702.34a: flashback — cast from your graveyard by paying the flashback cost instead.
  // CR 702.138a: escape — likewise, with its own cost.
  const escape = o.zone === 'graveyard' && o.owner === player && alt?.zone === 'graveyard';
  // CR 702.143a: a foretold card on a later turn; CR 702.170d: a plotted card on a later turn, as a sorcery.
  const fromExileAlt =
    o.zone === 'exile' &&
    o.owner === player &&
    ((alt?.id === 'foretell' && o.foretold !== undefined && o.foretold < g.turn) ||
      (alt?.id === 'plot' && o.plotted !== undefined && o.plotted < g.turn && g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0));
  // Emry, Lurker of the Loch: "You may cast that card this turn." — from a graveyard, for its mana cost.
  const permitted = o.zone === 'graveyard' && !escape && mayPlayFrom(g, player, o, 'spell');
  const flashback = o.zone === 'graveyard' && o.owner === player && !escape && !permitted ? flashbackCostOf(g, o, face) : null;
  // CR 702.127a: "You may cast this half of this split card from your graveyard."
  const aftermath = face.keywords.some((k) => k.id === 'aftermath');
  // "Until the end of your next turn, you may play that card."
  const fromExile = ((o.zone === 'exile' || o.zone === 'library') && mayPlayFrom(g, player, o, 'spell')) || permitted;
  // Bolas's Citadel: from the top of the library, life equal to its mana value instead of its mana cost (CR 118.9;
  // CR 107.3b: X is 0).
  const lifeInstead = !during && !alt && o.zone === 'library' && topLifeOnly(g, player, o);
  // "You may play it this turn without paying its mana cost" (CR 118.9; CR 107.3b: X is 0).
  const freeFromExile = !during && !alt && fromExile && o.zone === 'exile' && freePermission(g, player, o);
  if (lifeInstead || freeFromExile) x = 0;
  // CR 601.3: casting from anywhere else needs a rule or effect that allows it.
  if (!during && !fromCommandZone && !flashback && !escape && !fromExileAlt && !fromExile && !prepared && !aftermath && (o.zone !== 'hand' || o.owner !== player)) throw new RulesError('You can only cast spells from your hand.');
  if (alt?.zone === 'exile' && !fromExileAlt && !(during && o.zone === 'exile')) throw new RulesError(`That cost is for casting ${face.name} from exile.`);
  if (alt?.zone === 'graveyard' && !escape) throw new RulesError(`That cost is for casting ${face.name} from your graveyard.`);
  // CR 712.11: double-faced cards are cast front face up. CR 709.3 / CR 715.3: split and adventure cards choose a half.
  if (faceIndex > 0 && !CASTABLE_ALT_FACES.has(def.layout) && !prepared && !alt?.transformed) throw new RulesError(`${face.name} can’t be cast.`);
  // CR 702.127a: an aftermath half is cast only from its owner's graveyard; the other half not from there.
  if (aftermath && !(o.zone === 'graveyard' && o.owner === player)) throw new RulesError(`${face.name} can be cast only from your graveyard.`);
  // CR 305.9: a land can't be cast as a spell.
  if (face.types.includes('Land')) throw new RulesError(`${face.name} is a land. Play it instead.`);
  if (!Number.isInteger(x) || x < 0) throw new RulesError('X must be a whole number, 0 or more.');

  // CR 117.1a: instants any time you have priority; anything else during your main phase with an empty stack.
  // CR 702.8a: flash lets a card be cast any time you could cast an instant.
  // CR 702.190a: sneak — "any time you could cast an instant during your declare blockers step".
  if (alt?.id === 'sneak' && !(g.active === player && g.step === 'declare_blockers')) throw new RulesError(`${face.name} can be cast for its sneak cost only during your declare blockers step.`);
  // Teferi, Time Raveler: "Each opponent can cast spells only any time they could cast a sorcery." (CR 307.5)
  const instantSpeed = !playerRule(g, player, 'sorcery_timing') && (castFace.types.includes('Instant') || castFace.keywords.some((k) => k.id === 'flash') || flashPermission(g, player, o) || alt?.id === 'sneak');
  // CR 601.3: "Cast this spell only during combat" (and the like).
  // CR 101.2: a "can't cast" effect applies even when an effect lets it be cast as something resolves.
  const restricted = during ? castProhibition(g, player, castFace, o) : castRestrictionProblem(g, player, castFace, o);
  if (restricted) throw new RulesError(restricted);
  // CR 608.2g: casting as an effect resolves ignores timing.
  if (!instantSpeed && !during) {
    if (g.active !== player || (g.step !== 'main1' && g.step !== 'main2') || g.stack.length > 0) {
      throw new RulesError(`${faceDown ? 'A face-down creature' : face.name} can only be cast during your main phase while the stack is empty.`);
    }
  }

  // CR 601.2b–c: modes, then targets. Without enough legal targets the spell can't be cast.
  // Conditions on the mode count are checked as the spell is cast (CR 601.2b).
  // A bonus that depends on a cost ("if this spell was cast using teamwork") looks at the costs being chosen now.
  const holds = (c: ConditionNode) =>
    c.type === 'paid' ? extras.includes(String(c.cost)) || altId === c.cost : evalCondition(c, { g, controller: player, source: o, events: [], targets: [], x, memo: {} });
  // CR 702.47: cards spliced onto it add their rules text (and their splice costs, below).
  const splices = spliceCards(g, player, o, castFace, costChoices.splice);
  let program = spellProgram(castFace, modes, holds, added.some((a) => a.allModes));
  for (const s of splices) {
    if (!program) throw new RulesError(`${face.name} is resolved by hand; nothing can be spliced onto it here.`);
    program = appendProgram(program, s.program);
  }
  const targets = program
    ? chooseTargets(g, player, program.specs, chosenTargets, o, x)
    : chosenTargets?.some((t) => t.length)
      ? (() => {
          throw new RulesError(`${face.name} is resolved by hand; it doesn’t take targets here.`);
        })()
      : [];

  // CR 601.2f / CR 118.9: an alternative cost (flashback) replaces the mana cost.
  // CR 118.9: "without paying its mana cost" is an alternative cost of nothing (CR 107.3b: X is 0).
  const cost = parseManaCost(during?.free || alt?.id === 'plot' || lifeInstead || freeFromExile ? '' : (flashback ?? (alt ? (alt.withManaCost ? `${face.manaCost}${alt.cost.mana ?? ''}` : (alt.cost.mana ?? '')) : face.manaCost)));
  if (during?.free) x = 0;
  for (const a of added) addCost(cost, parseManaCost(a.cost.mana ?? ''));
  // CR 903.8: {2} more for each previous cast from the command zone (commander tax).
  if (fromCommandZone) cost.generic += 2 * (g.commanderCasts[id] ?? 0);
  if (kicked) {
    // CR 702.33a: the kicker cost is paid in addition (CR 601.2f); CR 702.33c: multikicker, any number of times.
    const kicker = face.keywords.find((k) => (k.id === 'kicker' || k.id === 'multikicker') && k.cost && /^(\{[^}]+\})+$/.test(k.cost));
    if (!kicker) throw new RulesError(`${face.name} has no kicker cost the engine can pay.`);
    if (kicker.id === 'kicker' && kicks > 1) throw new RulesError(`${face.name} can be kicked only once.`);
    for (let i = 0; i < kicks; i++) addCost(cost, parseManaCost(kicker.cost!));
  }
  // Strive: "costs {2}{W} more to cast for each target beyond the first" (CR 601.2f).
  addPerTargetCost(castFace, targets, cost);
  addModeCosts(castFace, modes, cost);
  for (const s of splices) addCost(cost, parseManaCost(s.cost));
  // CR 702.119a: emerge — reduced by the sacrificed creature's mana value (generic mana only, CR 118.7).
  if (alt?.reduceBySacrificed) {
    const sac = costChoices.sacrifice?.[0] ? g.objects[costChoices.sacrifice[0]] : undefined;
    if (sac) cost.generic = Math.max(0, cost.generic - manaValueOf(g, sac));
  }
  // CR 702.180a: harmonize — reduced by the tapped creature's power.
  if (alt?.reduceByTappedPower) {
    const tapped = costChoices.crew?.[0] ? g.objects[costChoices.crew[0]] : undefined;
    if (tapped) cost.generic = Math.max(0, cost.generic - Math.max(0, power(g, tapped)));
  }
  // CR 601.2f: then increases and reductions.
  applyCostModifiers(g, player, o, castFace, cost, targets);
  // CR 601.2g–h: convoke, improvise and delve pay part of it (the creatures tap, the cards are exiled, as it's paid).
  const helpers = face.keywords.map((k) => k.id).filter((k) => k === 'convoke' || k === 'delve' || k === 'improvise');
  const helping = costChoices.convoke?.length || costChoices.delve?.length || costChoices.improvise?.length;
  if (cost.unsupported.length) {
    throw new RulesError(`Paying ${cost.unsupported.map((s) => `{${s}}`).join('')} isn’t supported yet. Use manual moves for this card.`);
  }
  // CR 601.2f: additional costs ("As an additional cost to cast this spell, sacrifice a creature").
  // "discard X cards", "pay X life": X is the value chosen for the spell (CR 107.3a).
  const additional: Cost = {
    other: [
      ...additionalCosts(castFace),
      ...(alt?.cost.other ?? []),
      ...added.flatMap((a) => a.cost.other ?? []),
      ...(lifeInstead && manaValueOf(g, o) > 0 ? [{ type: 'pay_life', amount: manaValueOf(g, o) }] : []),
      // Terror of the Peaks: "Spells your opponents cast that target this creature cost an additional 3 life to cast."
      ...(targetLifeTax(g, player, targets) > 0 ? [{ type: 'pay_life', amount: targetLifeTax(g, player, targets) }] : []),
    ].map((c) => (c.amount === 'X' ? { ...c, amount: x } : c)),
  };
  checkOtherCosts(g, player, o, additional, costChoices);
  if (helping) payWithHelpers(g, player, o, helpers, cost, costChoices, events);
  // Creatures tapped for a cost (teamwork, conspire, harmonize) can't also tap for mana.
  if (wantsAutoTap) autoTap(g, player, cost, x, events, [...(costChoices.crew ?? [])], { kind: 'spell', object: o });

  // CR 601.2h: pay the total cost; partial payments aren't allowed.
  const spent = payMana(g, player, cost, x, { kind: 'spell', object: o });
  if (!spent) throw new RulesError(`Not enough mana to cast ${face.name}.`);
  // "The next spell you cast this turn …": this spell uses those effects up.
  const nextUsed = (g.nextSpell ?? []).filter((n) => n.player === player && n.turn === g.turn && matchesFilter(g, o, n.filter, { controller: player, source: g.objects[n.source.id] ?? null, anyZone: true }));
  if (g.nextSpell) g.nextSpell = g.nextSpell.filter((n) => n.turn === g.turn && !nextUsed.includes(n));
  // Cavern of Souls: "Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered."
  const uncounterableCast = lastSpentRestricted.some((r) => r.spend?.uncounterable) || nextUsed.some((n) => n.uncounterable);
  // Path of Ancestry: "When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1."
  const spentTriggers = lastSpentRestricted.flatMap((r) => {
    const src = r.source ? g.objects[r.source.id] : undefined;
    const filter = (r.onSpent?.trigger.filter ?? {}) as ObjectFilter;
    return r.onSpent && matchesFilter(g, o, filter, { controller: player, source: src ?? null, anyZone: true }) ? [{ ability: r.onSpent, source: r.source!, name: src ? nameOf(g, src) : 'mana' }] : [];
  });
  // CR 702.44a / converge: the colors of mana spent to cast it.
  const colorsSpent = (['W', 'U', 'B', 'R', 'G'] as const).filter((m) => spent[m] > 0).length;
  const lki = costLKI(g, additional, costChoices);
  payOtherCosts(g, player, o, additional, events, costChoices);

  if (fromCommandZone) g.commanderCasts[id] = (g.commanderCasts[id] ?? 0) + 1;
  const castFrom = o.zone;
  // CR 601.2a: the card moves to the stack and its caster becomes its controller.
  moveObject(g, id, 'stack', events, { controller: player, face: faceIndex, ...(faceDown ? { faceDown } : {}) });
  if (faceDown) ensureFaceDownDefs(g);
  // CR 702.103b: it becomes an Aura spell as it's put on the stack.
  if (alt?.id === 'bestow') o.bestowed = true;
  if (alt?.prototype) o.prototyped = true;
  if (splices.length) events.push({ type: 'revealed', player, objects: splices.map((s) => s.id) });
  // CR 722.3c: the permanent loses the prepared designation as the spell becomes cast; the copy is a spell copy now.
  if (prepared) {
    delete o.prepareOf;
    o.spellCopy = true;
    unprepare(g, prepared, events);
  }
  // CR 702.34a: if the flashback cost was paid, it's exiled instead of going anywhere else as it leaves the stack.
  // CR 702.127a: so is an aftermath half cast from a graveyard; jump-start too (CR 702.133a).
  if (flashback || aftermath || alt?.exileOnLeave || during?.exileOnLeave) o.exileOnLeave = true;
  // CR 702.40a: storm counts the spells cast before this one this turn.
  const before = Object.values(g.turnLog.spellsCast).reduce((a, b) => a + b, 0);
  const paid = [...(alt ? [alt.id] : []), ...extras, ...(kicked ? ['kicker'] : [])];
  // CR 702.174a: the gift's cost is choosing an opponent.
  const opponents = livePlayers(g).filter((p) => p !== player);
  const giftTo = paid.includes('gift') ? (costChoices.giftTo ?? opponents[0]) : undefined;
  if (giftTo && !opponents.includes(giftTo)) throw new RulesError('Promise the gift to an opponent.');
  o.cast = {
    by: player,
    from: during ? castFrom : fromCommandZone ? 'command' : flashback || escape || aftermath ? 'graveyard' : fromExile || prepared ? (castFrom === 'library' || castFrom === 'graveyard' ? castFrom : 'exile') : 'hand',
    before,
    ...(kicked ? { kicked: true as const, kicks } : {}),
    ...(paid.length ? { paid } : {}),
    ...(colorsSpent ? { colors: colorsSpent } : {}),
    // CR 702.62a: a creature spell cast this way gains haste.
    ...(during?.suspended ? { suspended: true as const } : {}),
    ...(giftTo ? { giftTo } : {}),
    ...(uncounterableCast ? { uncounterable: true as const } : {}),
  };
  for (const t of spentTriggers) g.triggers.push({ id: `t${g.nextId++}`, controller: player, source: t.source, sourceName: t.name, ability: t.ability, info: { object: { id: o.id, zcc: o.zcc } } });
  // CR 702.174b / 702.174j: an instant or sorcery whose gift was promised gives it first, as it resolves.
  const giftSpell = giftTo ? castFace.abilities.find((a) => a.kind === 'static' && a.effect.type === 'gift_spell') : undefined;
  if (program && giftSpell && giftSpell.kind === 'static') program.effects.unshift({ type: 'give_gift', effects: giftSpell.effect.effects });
  // CR 601.2d: the division of its damage among the targets.
  const counted = (a: unknown) => amountOf({ g, controller: player, source: o, events: [], targets, x, memo: {} }, a as Amount);
  const division = program ? divisionFor(program.effects, targets, x, divide, counted) : undefined;
  g.stack.push({ kind: 'spell', object: id, controller: player, x, targets, ...(program ? { program } : {}), ...(lki ? { costLKI: lki } : {}), ...(division ? { division } : {}) });
  // CR 700.14: the mana spent to cast spells this turn, before and after this one ("Whenever you expend 4").
  const spentNow = Object.values(spent).reduce((a, b) => a + b, 0);
  const manaBefore = g.turnLog.manaSpent?.[player] ?? 0;
  (g.turnLog.manaSpent ??= {})[player] = manaBefore + spentNow;
  events.push({ type: 'cast', player, object: id, nth: (g.turnLog.spellsCast[player] ?? 0) + 1, manaBefore, manaSpent: spentNow });
  announceTargets(g.stack[g.stack.length - 1]!, events, g);
  // CR 601.2i: a player who had priority when casting gets priority afterward (not mid-resolution).
  if (!during) givePriority(g, player);
}

/** How many times this turn an ability with a per-turn limit has been activated. */
export function activationsThisTurn(g: GameState, o: GameObject, index: number): number {
  const a = o.activations?.[index];
  return a && a.turn === g.turn ? a.n : 0;
}

/**
 * CR 601.3: "Cast this spell only during combat", "… only during the declare attackers step and only if you've been
 * attacked this step", "… only if you've cast another spell this turn". Why it can't be cast now, or null.
 */
export function castRestrictionProblem(g: GameState, player: PlayerId, face: FaceDef, spell: GameObject): string | null {
  const banned = castProhibition(g, player, face, spell);
  if (banned) return banned;
  for (const a of face.abilities) {
    if (a.kind !== 'static' || a.effect.type !== 'cast_restriction') continue;
    const r = a.effect;
    const step = g.step;
    const combat = ['beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat'].includes(step);
    const ok: Record<string, boolean> = {
      combat,
      declare_attackers: step === 'declare_attackers',
      declare_blockers: step === 'declare_blockers',
      before_blockers: step === 'beginning_of_combat' || step === 'declare_attackers',
      after_blockers: step === 'declare_blockers' || step === 'combat_damage' || step === 'end_of_combat',
      before_damage: STEPS.indexOf(step) < STEPS.indexOf('combat_damage'),
      after_combat: step === 'main2' || step === 'end' || step === 'cleanup',
      before_combat: STEPS.indexOf(step) < STEPS.indexOf('beginning_of_combat') || step === 'beginning_of_combat' || step === 'declare_attackers',
      upkeep: step === 'upkeep',
    };
    if (r.during && !ok[String(r.during)]) return `${face.name} can't be cast now.`;
    if (r.whose === 'your' && g.active !== player) return `${face.name} can only be cast during your turn.`;
    if (r.whose === 'opponent' && g.active === player) return `${face.name} can only be cast during an opponent's turn.`;
    // "and only if you've been attacked this step"
    if (r.attacked && !Object.values(g.combat?.attackers ?? {}).some((x) => (x.target.kind === 'player' ? x.target.player : g.objects[x.target.object]?.controller) === player)) {
      return `${face.name} can only be cast if you've been attacked.`;
    }
    if (r.condition && !evalCondition(r.condition as ConditionNode, { g, controller: player, source: spell, events: [], targets: [], x: 0, memo: {} })) return `${face.name} can't be cast now.`;
  }
  return null;
}

/**
 * CR 702.47a–b: "Splice onto Arcane [cost]" — cards in your hand revealed as you cast an Arcane spell, each at most
 * once; the spell gains their rules text, and their splice costs are additional costs.
 */
function spliceCards(g: GameState, player: PlayerId, spell: GameObject, face: FaceDef, ids: ObjectId[] | undefined): { id: ObjectId; cost: string; program: CompiledProgram }[] {
  if (!ids?.length) return [];
  if (new Set(ids).size !== ids.length) throw new RulesError('Each card can be spliced onto a spell only once.');
  return ids.map((id) => {
    const card = g.objects[id];
    if (!card || card.zone !== 'hand' || card.owner !== player || id === spell.id) throw new RulesError('Splice cards come from your hand.');
    const cardFace = g.cards[card.card]!.faces[0]!;
    const kw = cardFace.keywords.find((k) => k.id === 'splice' && k.cost && /^(\{[^}]+\})+$/.test(k.cost));
    if (!kw) throw new RulesError(`${cardFace.name} has no splice cost the engine can pay.`);
    const quality = (kw.text ?? 'Arcane').toLowerCase();
    const fits = quality === 'arcane' ? face.subtypes.includes('Arcane') : face.types.includes('Instant') || face.types.includes('Sorcery');
    if (!fits) throw new RulesError(`${cardFace.name} splices only onto ${quality === 'arcane' ? 'Arcane' : 'instant or sorcery'} spells.`);
    const programs = spellPrograms(cardFace);
    if (!programs) throw new RulesError(`${cardFace.name}'s text is resolved by hand; it can't be spliced here.`);
    return { id, cost: kw.cost!, program: flatten(programs, undefined) };
  });
}

/** CR 702.193a: "If this permanent entered this turn, this ability's cost is reduced by this permanent's mana cost." */
export function applyPowerUp(g: GameState, o: GameObject, ability: ActivatedAbility, mana: ManaCost, player: PlayerId = o.controller): void {
  // "This ability costs {1} less to activate for each legendary creature you control." — generic mana only.
  const r = ability.costReduction;
  if (r) {
    const ctx = { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} };
    const applies = (!r.condition || evalCondition(r.condition, ctx)) && (!r.yourTurn || g.active === player);
    const n = applies ? r.amount * (r.per ? Math.max(0, amountOf(ctx, r.per)) : 1) : 0;
    if (n > 0) mana.generic = Math.max(0, mana.generic - n);
  }
  // Training Grounds, Zirda: "Activated abilities of creatures you control cost {2} less to activate. This effect can't
  // reduce the mana in that cost to less than one mana." (CR 601.2f, 118.7: generic mana only)
  if (ability.cost.loyalty === undefined) {
    for (const id of abilitySources(g)) {
      const src = g.objects[id]!;
      for (const a of objectAbilities(g, src)) {
        if (a.kind !== 'static' || a.effect.type !== 'ability_cost_reduction') continue;
        // Zirda: "Abilities you activate that aren't mana abilities …"
        if (a.effect.byYou ? player !== src.controller : !matchesFilter(g, o, a.effect.filter as ObjectFilter, { controller: src.controller, source: src })) continue;
        const others = Object.values(mana.specific).reduce((s, v) => s + (v ?? 0), 0) + mana.hybrid.length + mana.x;
        if (mana.generic + others === 0) continue;
        const floor = a.effect.minOne && others === 0 ? 1 : 0;
        mana.generic = Math.max(floor, mana.generic - Number(a.effect.amount ?? 0));
      }
    }
  }
  if (!ability.powerUp) return;
  const entered = Object.values(g.turnLog.entered ?? {}).some((ids) => ids.includes(o.id));
  if (entered) reduceCostBy(mana, parseManaCost(faceOf(g, o).manaCost));
}

/** CR 702.172a / 702.183a: spree and tiered — each chosen mode's cost is an additional cost. */
export function addModeCosts(face: FaceDef, modes: readonly number[] | undefined, cost: ManaCost): void {
  // CR 702.120a: escalate — an additional [cost] for each mode chosen beyond the first.
  const escalate = face.keywords.find((k) => k.id === 'escalate' && k.cost && /^(\{[^}]+\})+$/.test(k.cost));
  if (escalate) for (let i = 1; i < (modes?.length ?? 0); i++) addCost(cost, parseManaCost(escalate.cost!));
  for (const a of face.abilities) {
    if (a.kind !== 'spell' || !a.modes) continue;
    for (const m of modes ?? []) {
      const c = a.modes.options[m]?.cost;
      if (c) addCost(cost, parseManaCost(c));
    }
  }
}
export const hasModeCosts = (face: FaceDef) => face.keywords.some((k) => k.id === 'escalate') || face.abilities.some((a) => a.kind === 'spell' && a.modes?.options.some((o) => o.cost));

/** Strive: "This spell costs {2}{W} more to cast for each target beyond the first." (CR 601.2f) */
export function addPerTargetCost(face: FaceDef, targets: readonly (readonly unknown[])[] | undefined, cost: ManaCost): void {
  const chosen = (targets ?? []).reduce((n, list) => n + list.length, 0);
  for (const a of face.abilities) {
    if (a.kind !== 'static' || a.effect.type !== 'per_target_cost') continue;
    for (let i = 1; i < chosen; i++) addCost(cost, parseManaCost(String(a.effect.cost)));
  }
}

/** CR 608.2g: cast a card as an effect resolves, without paying its mana cost. */
export function castDuringResolution(
  g: GameState,
  player: PlayerId,
  id: ObjectId,
  targets: Target[][] | undefined,
  modes: number[] | undefined,
  events: GameEvent[],
  opts: { alt?: string; suspended?: true; exileOnLeave?: true } = {},
): void {
  // With an alternative cost (madness) it's paid, tapping for mana as needed; otherwise it's free.
  // A required choice of additional costs (CR 118.8): one that needs nothing chosen (life, mana) if there is one.
  const choices = castOptions(g.cards[g.objects[id]!.card]!.faces[0]!).filter((x) => x.required);
  const pick = choices.find((x) => (x.cost.other ?? []).every((c) => c.type === 'pay_life')) ?? choices[0];
  cast(g, player, id, 0, 0, Boolean(opts.alt) || Boolean(pick?.cost.mana), targets, modes, events, {}, false, opts.alt, pick ? [pick.id] : [], { free: !opts.alt, ...(opts.suspended ? { suspended: true } : {}), ...(opts.exileOnLeave ? { exileOnLeave: true } : {}) });
}

/** Whether a card could be cast right now for free: not a land (CR 305.9). */
export function castableCard(g: GameState, o: GameObject): boolean {
  const face = g.cards[o.card]?.faces[0];
  return Boolean(face && !face.types.includes('Land'));
}

// ---------------------------------------------------------------------------
// Compiled activated abilities (CR 602)
// ---------------------------------------------------------------------------

interface ActivationChoices {
  x: number;
  autoTap: boolean;
  targets: Target[][] | undefined;
  modes: number[] | undefined;
  costs: CostChoices;
  divide?: number[];
}

function activate(g: GameState, player: PlayerId, id: ObjectId, index: number, choices: ActivationChoices, events: GameEvent[]): void {
  const o = obj(g, id);
  // CR 602.2: only an object's controller (or owner, outside the battlefield) can activate its abilities.
  const yours = o.zone === 'battlefield' ? o.controller === player : (o.zone === 'hand' || o.zone === 'graveyard') && o.owner === player;
  const ability: ActivatedAbility | undefined = activatedAbilities(g, o)[index];
  // "Any player may activate this ability." (CR 602.2)
  if (!yours && !(o.zone === 'battlefield' && ability?.anyPlayer)) throw new RulesError('You can’t activate abilities of that object.');
  if (!ability) throw new RulesError(`${nameOf(g, o)} has no such ability.`);
  // CR 101.2: "your opponents can't … activate abilities of artifacts, creatures, or enchantments"
  if (activationProhibited(g, player, o, false)) throw new RulesError(`You can’t activate ${nameOf(g, o)}’s abilities now.`);
  if (ability.maxPerTurn && activationsThisTurn(g, o, index) >= ability.maxPerTurn) throw new RulesError(`That ability can be activated only ${ability.maxPerTurn} times each turn.`);
  const name = nameOf(g, o);
  const sorcerySpeed = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;
  // Chatterfang: "Sacrifice X Squirrels" — X is announced as it's activated (CR 107.3a, 602.2b).
  const cost = ability.cost.other?.some((c) => c.amount === 'X') ? { ...ability.cost, other: ability.cost.other.map((c) => (c.amount === 'X' ? { ...c, amount: choices.x } : c)) } : ability.cost;

  if (cost.loyalty !== undefined) {
    // CR 606.3: main phase, empty stack, and only one loyalty ability per permanent each turn.
    if (!sorcerySpeed) throw new RulesError('Loyalty abilities can only be activated during your main phase with an empty stack.');
    if (o.loyaltyActivatedTurn === g.turn) throw new RulesError(`You’ve already activated a loyalty ability of ${name} this turn.`);
    // CR 606.6: a negative loyalty cost needs at least that many loyalty counters.
    if ((o.counters.loyalty ?? 0) + cost.loyalty < 0) throw new RulesError(`${name} doesn’t have enough loyalty.`);
  }
  // CR 602.5d: "Activate only as a sorcery."
  if (ability.timing === 'sorcery' && !sorcerySpeed) throw new RulesError(`That ability can only be activated as a sorcery.`);
  // "Activate only if this Class is level 1" (CR 716.2a) and other conditions on activating.
  if (ability.activateIf && !evalCondition(ability.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) {
    throw new RulesError('That ability can’t be activated now.');
  }
  if (ability.oncePerTurn && o.activatedTurn?.[index] === g.turn) throw new RulesError('That ability can be activated only once each turn.');
  if (ability.oncePerGame && o.activatedOnce?.[index]) throw new RulesError('That ability can be activated only once.');
  if (cost.tap) {
    // CR 118.3 / CR 302.6
    if (o.tapped) throw new RulesError(`${name} is already tapped.`);
    if (!canActivateTapAbilities(g, o)) throw new RulesError(`${name} hasn’t been under your control since your turn began.`);
  }
  if (cost.untap && !o.tapped) throw new RulesError(`${name} is already untapped.`);
  // CR 302.6: the untap symbol too.
  if (cost.untap && !canActivateTapAbilities(g, o)) throw new RulesError(`${name} hasn’t been under your control since your turn began.`);
  checkOtherCosts(g, player, o, cost, choices.costs);

  // CR 602.2b (following CR 601.2b–c): modes and targets.
  const program = flatten([ability], choices.modes);
  const targets = chooseTargets(g, player, program.specs, choices.targets, o, choices.x);
  const division = divisionFor(program.effects, targets, choices.x, choices.divide, (a) => amountOf({ g, controller: player, source: o, events: [], targets, x: choices.x, memo: {} }, a as Amount));
  const source = { id, zcc: o.zcc };

  // CR 602.2b (following CR 601.2g–h): mana abilities, then the whole cost is paid.
  const mana = parseManaCost(cost.mana ?? '');
  applyPowerUp(g, o, ability, mana, player);
  if (!Number.isInteger(choices.x) || choices.x < 0) throw new RulesError('X must be a whole number, 0 or more.');
  if (mana.unsupported.length) throw new RulesError(`Paying ${mana.unsupported.map((s) => `{${s}}`).join('')} isn’t supported yet.`);
  // Permanents the cost itself taps or sacrifices can't also be tapped for mana.
  const usesItself = [...(cost.tap || cost.other?.some((c) => c.type === 'sacrifice_self') ? [id] : []), ...(choices.costs.sacrifice ?? []), ...(choices.costs.crew ?? [])];
  if (cost.mana && choices.autoTap) autoTap(g, player, mana, choices.x, events, usesItself, { kind: 'ability', source: o });
  if (cost.mana && !payMana(g, player, mana, choices.x, { kind: 'ability', source: o })) throw new RulesError('Not enough mana to activate that.');
  if (cost.tap) setTapped(g, id, true, events);
  if (cost.untap) setTapped(g, id, false, events);
  if (cost.loyalty !== undefined) {
    // CR 606.4: the cost is putting on or removing loyalty counters.
    o.counters.loyalty = (o.counters.loyalty ?? 0) + cost.loyalty;
    o.loyaltyActivatedTurn = g.turn;
    events.push({ type: 'counters', object: id, counter: 'loyalty', delta: cost.loyalty, by: player });
  }
  if (ability.oncePerTurn) (o.activatedTurn ??= {})[index] = g.turn;
  if (ability.maxPerTurn) (o.activations ??= {})[index] = { turn: g.turn, n: activationsThisTurn(g, o, index) + 1 };
  if (ability.oncePerGame) (o.activatedOnce ??= {})[index] = true;
  const lki = costLKI(g, cost, choices.costs);
  payOtherCosts(g, player, o, cost, events, choices.costs);

  // CR 602.2: the ability goes on the stack.
  g.stack.push({
    kind: 'ability',
    id: `a${g.nextId++}`,
    source,
    sourceName: name,
    controller: player,
    text: ability.text,
    program,
    targets,
    x: choices.x,
    ...(lki ? { costLKI: lki } : {}),
    ...(division ? { division } : {}),
  });
  events.push({ type: 'ability_activated', player, source: id, text: ability.text, entry: g.stack[g.stack.length - 1]!.kind === 'ability' ? (g.stack[g.stack.length - 1] as { id: string }).id : '', ...(cost.loyalty !== undefined ? { loyalty: true as const } : {}) });
  announceTargets(g.stack[g.stack.length - 1]!, events, g);
  // CR 117.3c: the activating player receives priority afterward.
  givePriority(g, player);
}

// ---------------------------------------------------------------------------
// Activated abilities the compiler couldn't parse (resolved by hand)
// ---------------------------------------------------------------------------

const LOYALTY_COST = /^([+−-]?)(\d+|X)$/;

function activateManual(
  g: GameState,
  player: PlayerId,
  id: ObjectId,
  lineIndex: number,
  wantsAutoTap: boolean,
  events: GameEvent[],
): void {
  const o = obj(g, id);
  // CR 602.2: only an object's controller can activate its abilities.
  if (o.zone !== 'battlefield' || o.controller !== player) throw new RulesError('You don’t control that permanent.');
  const face = faceOf(g, o);
  const line = face.unparsed[lineIndex];
  const colon = line?.indexOf(': ') ?? -1;
  if (!line || colon < 0) throw new RulesError('That line isn’t an activated ability.');
  const costText = line.slice(0, colon).trim();
  const effectText = line.slice(colon + 2);
  const sorcerySpeed = () => g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;

  const loyalty = LOYALTY_COST.exec(costText);
  if (loyalty && face.types.includes('Planeswalker')) {
    // CR 606.3: main phase, empty stack, once per turn per permanent.
    if (!sorcerySpeed()) throw new RulesError('Loyalty abilities can only be activated during your main phase with an empty stack.');
    if (o.loyaltyActivatedTurn === g.turn) throw new RulesError(`You’ve already activated a loyalty ability of ${face.name} this turn.`);
    if (loyalty[2] === 'X') throw new RulesError('X loyalty costs aren’t supported yet; adjust counters manually.');
    const delta = (loyalty[1] === '−' || loyalty[1] === '-' ? -1 : 1) * Number(loyalty[2]);
    const current = o.counters.loyalty ?? 0;
    // CR 606.6: a negative loyalty cost needs at least that many loyalty counters.
    if (current + delta < 0) throw new RulesError(`${face.name} doesn’t have enough loyalty.`);
    // CR 606.4: the cost is adding or removing loyalty counters.
    o.counters.loyalty = current + delta;
    o.loyaltyActivatedTurn = g.turn;
    events.push({ type: 'counters', object: id, counter: 'loyalty', delta, by: player });
  } else {
    // CR 602.5d: "Activate only as a sorcery" follows sorcery timing.
    if (/Activate only as a sorcery/i.test(effectText) && !sorcerySpeed()) {
      throw new RulesError('That ability can only be activated as a sorcery.');
    }
    let tap = false;
    let mana = '';
    for (const part of costText.split(/,\s*/)) {
      if (part === '{T}') tap = true;
      else if (/^(\{[^}]+\})+$/.test(part)) mana += part;
      // Other costs (sacrifice, discard, life…) are paid by the player with manual moves.
    }
    if (tap) {
      if (o.tapped) throw new RulesError(`${face.name} is already tapped.`);
      if (!canActivateTapAbilities(g, o)) throw new RulesError(`${face.name} hasn’t been under your control since your turn began.`);
    }
    if (mana) {
      const cost = parseManaCost(mana);
      if (wantsAutoTap) autoTap(g, player, cost, 0, events, [], { kind: 'ability', source: o });
      if (!payMana(g, player, cost, 0, { kind: 'ability', source: o })) throw new RulesError('Not enough mana to activate that.');
    }
    if (tap) setTapped(g, id, true, events);
  }

  // CR 602.2: the ability goes on the stack.
  g.stack.push({
    kind: 'ability',
    id: `a${g.nextId++}`,
    source: { id, zcc: o.zcc },
    sourceName: face.name,
    controller: player,
    text: line,
    manual: true,
    targets: [],
    x: 0,
  });
  events.push({ type: 'ability_activated', player, source: id, text: line, entry: (g.stack[g.stack.length - 1] as { id: string }).id, ...(LOYALTY_COST.test(line.split(':')[0]!.trim()) ? { loyalty: true as const } : {}) });
  // CR 117.3c: the activating player receives priority afterward.
  givePriority(g, player);
}

// ---------------------------------------------------------------------------
// Manual moves: the escape hatch for anything the engine can't run yet.
// Not rules actions — every one is logged so all players can see it.
// ---------------------------------------------------------------------------

function manual(g: GameState, player: PlayerId, op: ManualOp, events: GameEvent[]): void {
  const resolving = g.pending?.kind === 'manual_resolution' && g.pending.player === player;
  if (!resolving) {
    if (g.pending) throw new RulesError(`Waiting for ${g.players[g.pending.player]!.name} to choose.`);
    if (g.priority !== player) throw new RulesError('You need priority (or a spell resolving) to make manual moves.');
  }
  switch (op.kind) {
    case 'move': {
      const o = obj(g, op.object);
      if (op.to === 'stack') throw new RulesError('Cast spells instead of moving them to the stack.');
      if (o.zone === 'stack') throw new RulesError('Resolve or counter spells instead of moving them off the stack.');
      moveObject(g, op.object, op.to, events, op.position ? { position: op.position } : {});
      break;
    }
    case 'life': {
      const target = g.players[op.target];
      if (!target || target.lost) throw new RulesError('No such player.');
      target.life += op.delta;
      events.push({ type: 'life', player: op.target, delta: op.delta, life: target.life });
      break;
    }
    case 'tap':
      setTapped(g, op.object, op.tapped, events);
      break;
    case 'counters': {
      const o = obj(g, op.object);
      const next = (o.counters[op.counter] ?? 0) + op.delta;
      if (next < 0) throw new RulesError(`There aren’t that many ${op.counter} counters.`);
      o.counters[op.counter] = next;
      events.push({ type: 'counters', object: op.object, counter: op.counter, delta: op.delta });
      break;
    }
    case 'draw':
      for (let i = 0; i < op.count; i++) drawCard(g, player, events);
      break;
  }
  events.push({ type: 'manual', player, op });
  if (!resolving) givePriority(g, player);
}

