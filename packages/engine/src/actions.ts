import { auraTargetSpec } from './permanents.js';
import { payWithHelpers } from './helpers-cost.js';
import { ensureFaceDownDefs, faceDownFace, FACE_DOWN_KEYWORDS } from './face-down.js';
import type { ActivatedAbility, ConditionNode, Cost, EffectNode, FaceDef, CastOptionNode, SpellAbility } from '@mtg/schema';
import { assignCombatDamage, declareAttackers, declareBlockers, promptNextBlocker } from './combat.js';
import { canUseTapAbilities, isPermanentCard } from './characteristics.js';
import { printedAbilities } from './characteristics.js';
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
import { parseManaCost, payFromPool, type ManaCost } from './mana.js';
import { autoTap, checkOtherCosts, payOtherCosts, runManaAbility } from './payment.js';
import { activatedAbilities, flatten, spellPrograms } from './program.js';
import { answerOpening } from './setup.js';
import { chooseTargets } from './targets.js';
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
  type ManualOp,
  type ObjectId,
  type PlayerId,
  type Target,
} from './types.js';
import { landsAllowed, playerRule } from './player-rules.js';
import { answerAsEnters } from './as-enters.js';
import { applyCostModifiers } from './costs.js';
import { mayPlayFrom } from './permissions.js';
import { drawCard, faceOf, moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';

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

  switch (a.type) {
    case 'pass':
      return passPriority(g, a.player, events);
    case 'play_land':
      return playLand(g, a.player, a.object, a.face ?? 0, events);
    case 'turn_face_up':
      return turnFaceUp(g, a.player, a.object, a.autoTap ?? false, events);
    case 'cast':
      return cast(g, a.player, a.object, a.face ?? 0, a.x ?? 0, a.autoTap ?? false, a.targets, a.modes, events, a.costs ?? {}, a.kicked ?? false, a.alt, a.extras ?? []);
    case 'activate':
      return activate(g, a.player, a.object, a.ability, { x: a.x ?? 0, autoTap: a.autoTap ?? false, targets: a.targets, modes: a.modes, costs: a.costs ?? {} }, events);
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
      for (const id of ids) moveObject(g, id, 'graveyard', events);
      finishCleanup(g, events);
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
      declareAttackers(g, answer.attacks, events);
      // CR 508.2: then the active player gets priority.
      givePriority(g, g.active);
      return;
    case 'declare_blockers':
      declareBlockers(g, player, answer.blocks, events);
      promptNextBlocker(g);
      // CR 509.2: once blockers are declared, the active player gets priority.
      if (!g.pending) givePriority(g, g.active);
      return;
    case 'assign_combat_damage':
      assignCombatDamage(g, answer.assignments, events);
      // CR 510.3: then the active player gets priority.
      givePriority(g, g.active);
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
    case 'copy_targets':
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

/** CR 702.37e / 116.2b: turn a face-down permanent you control face up — a special action. */
function turnFaceUp(g: GameState, player: PlayerId, id: ObjectId, wantsAutoTap: boolean, events: GameEvent[]): void {
  const o = obj(g, id);
  if (!o.faceDown || o.zone !== 'battlefield' || o.controller !== player) throw new RulesError('You can only turn a face-down permanent you control face up.');
  const costText = faceUpCost(g, o);
  if (!costText) throw new RulesError('That can’t be turned face up.');
  const cost = parseManaCost(costText);
  if (cost.unsupported.length || cost.x) throw new RulesError(`Paying ${costText} isn’t supported yet.`);
  if (wantsAutoTap) autoTap(g, player, cost, 0, events);
  const left = payFromPool(g.players[player]!.pool, cost, 0);
  if (!left) throw new RulesError(`Not enough mana to pay ${costText}.`);
  g.players[player]!.pool = left;
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
  const fromExile = o.zone === 'exile' && mayPlayFrom(g, player, o, 'land');
  if (!fromExile && (o.zone !== 'hand' || o.owner !== player)) throw new RulesError('You can only play lands from your hand.');
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
  choice: number | ManaColor | undefined,
  events: GameEvent[],
  costs: CostChoices = {},
): void {
  // CR 605.3a: mana abilities can be activated with priority, or while something asks for a mana payment.
  const paying = (g.pending?.kind === 'manual_resolution' || g.pending?.kind === 'pay') && g.pending.player === player;
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

/** A face's additional costs to cast (CR 601.2f), from its "As an additional cost…" lines. */
export function additionalCosts(face: FaceDef): EffectNode[] {
  return face.abilities.flatMap((a) => (a.kind === 'static' && a.effect.type === 'additional_cost' ? [a.effect.cost as EffectNode] : []));
}

/** CR 118.9 / 601.2f: the alternative and optional additional costs a face offers as it's cast. */
export function castOptions(face: FaceDef): CastOptionNode[] {
  const out = printedAbilities(face).flatMap((a) => (a.kind === 'static' && a.effect.type === 'cast_option' ? [a.effect as CastOptionNode] : []));
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
  kicked: boolean,
  altId?: string,
  extras: string[] = [],
): void {
  const o = obj(g, id);
  const def = g.cards[o.card]!;
  const face = def.faces[faceIndex];
  if (!face) throw new RulesError('That card has no such face.');
  // CR 118.9 / 601.2b: an alternative cost and optional additional costs, announced as it's cast.
  const options = castOptions(face);
  const alt = altId ? options.find((x) => x.kind === 'alternative' && x.id === altId) : undefined;
  if (altId && !alt) throw new RulesError(`${face.name} has no “${altId}” cost.`);
  const added = extras.map((x) => {
    const opt = options.find((y) => y.kind === 'additional' && y.id === x);
    if (!opt) throw new RulesError(`${face.name} has no optional “${x}” cost.`);
    return opt;
  });
  if (new Set(extras).size !== extras.length) throw new RulesError('Each optional cost can be paid once.');
  if (alt?.condition && !evalCondition(alt.condition, { g, controller: player, source: o, events: [], targets: [], x, memo: {} })) {
    throw new RulesError(`${face.name} can’t be cast for that cost now.`);
  }
  // CR 702.37c / 702.168b: cast face down, it's a 2/2 creature spell with no text (CR 708.4).
  const faceDown = alt && (FACE_DOWN_KEYWORDS as readonly string[]).includes(alt.id) ? (alt.id === 'disguise' ? 'disguise' : 'morph') : undefined;
  const castFace = faceDown ? faceDownFace({ ...o, faceDown }) : face;
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
  const flashback = o.zone === 'graveyard' && o.owner === player && !escape ? flashbackCost(face) : null;
  // "Until the end of your next turn, you may play that card."
  const fromExile = o.zone === 'exile' && mayPlayFrom(g, player, o, 'spell');
  // CR 601.3: casting from anywhere else needs a rule or effect that allows it.
  if (!fromCommandZone && !flashback && !escape && !fromExile && (o.zone !== 'hand' || o.owner !== player)) throw new RulesError('You can only cast spells from your hand.');
  if (alt?.zone === 'graveyard' && !escape) throw new RulesError(`That cost is for casting ${face.name} from your graveyard.`);
  // CR 712.11: double-faced cards are cast front face up. CR 709.3 / CR 715.3: split and adventure cards choose a half.
  if (faceIndex > 0 && !CASTABLE_ALT_FACES.has(def.layout)) throw new RulesError(`${face.name} can’t be cast.`);
  // CR 305.9: a land can't be cast as a spell.
  if (face.types.includes('Land')) throw new RulesError(`${face.name} is a land. Play it instead.`);
  if (!Number.isInteger(x) || x < 0) throw new RulesError('X must be a whole number, 0 or more.');

  // CR 117.1a: instants any time you have priority; anything else during your main phase with an empty stack.
  // CR 702.8a: flash lets a card be cast any time you could cast an instant.
  const instantSpeed = castFace.types.includes('Instant') || castFace.keywords.some((k) => k.id === 'flash') || playerRule(g, player, 'flash');
  if (!instantSpeed) {
    if (g.active !== player || (g.step !== 'main1' && g.step !== 'main2') || g.stack.length > 0) {
      throw new RulesError(`${faceDown ? 'A face-down creature' : face.name} can only be cast during your main phase while the stack is empty.`);
    }
  }

  // CR 601.2b–c: modes, then targets. Without enough legal targets the spell can't be cast.
  // Conditions on the mode count are checked as the spell is cast (CR 601.2b).
  const program = spellProgram(castFace, modes, (c) => evalCondition(c, { g, controller: player, source: o, events: [], targets: [], x, memo: {} }), added.some((a) => a.allModes));
  const targets = program
    ? chooseTargets(g, player, program.specs, chosenTargets, o)
    : chosenTargets?.some((t) => t.length)
      ? (() => {
          throw new RulesError(`${face.name} is resolved by hand; it doesn’t take targets here.`);
        })()
      : [];

  // CR 601.2f / CR 118.9: an alternative cost (flashback) replaces the mana cost.
  const cost = parseManaCost(flashback ?? (alt ? (alt.cost.mana ?? '') : face.manaCost));
  for (const a of added) addCost(cost, parseManaCost(a.cost.mana ?? ''));
  // CR 903.8: {2} more for each previous cast from the command zone (commander tax).
  if (fromCommandZone) cost.generic += 2 * (g.commanderCasts[id] ?? 0);
  if (kicked) {
    // CR 702.33a: the kicker cost is paid in addition (CR 601.2f).
    const kicker = face.keywords.find((k) => k.id === 'kicker' && k.cost && /^(\{[^}]+\})+$/.test(k.cost));
    if (!kicker) throw new RulesError(`${face.name} has no kicker cost the engine can pay.`);
    addCost(cost, parseManaCost(kicker.cost!));
  }
  // CR 601.2f: then increases and reductions.
  applyCostModifiers(g, player, o, castFace, cost);
  // CR 601.2g–h: convoke, improvise and delve pay part of it (the creatures tap, the cards are exiled, as it's paid).
  const helpers = face.keywords.map((k) => k.id).filter((k) => k === 'convoke' || k === 'delve' || k === 'improvise');
  const helping = costChoices.convoke?.length || costChoices.delve?.length || costChoices.improvise?.length;
  if (cost.unsupported.length) {
    throw new RulesError(`Paying ${cost.unsupported.map((s) => `{${s}}`).join('')} isn’t supported yet. Use manual moves for this card.`);
  }
  // CR 601.2f: additional costs ("As an additional cost to cast this spell, sacrifice a creature").
  const additional: Cost = { other: [...additionalCosts(castFace), ...(alt?.cost.other ?? []), ...added.flatMap((a) => a.cost.other ?? [])] };
  checkOtherCosts(g, player, o, additional, costChoices);
  if (helping) payWithHelpers(g, player, o, helpers, cost, costChoices, events);
  if (wantsAutoTap) autoTap(g, player, cost, x, events);

  // CR 601.2h: pay the total cost; partial payments aren't allowed.
  const left = payFromPool(g.players[player]!.pool, cost, x);
  if (!left) throw new RulesError(`Not enough mana to cast ${face.name}.`);
  g.players[player]!.pool = left;
  payOtherCosts(g, player, o, additional, events, costChoices);

  if (fromCommandZone) g.commanderCasts[id] = (g.commanderCasts[id] ?? 0) + 1;
  // CR 601.2a: the card moves to the stack and its caster becomes its controller.
  moveObject(g, id, 'stack', events, { controller: player, face: faceIndex, ...(faceDown ? { faceDown } : {}) });
  if (faceDown) ensureFaceDownDefs(g);
  // CR 702.34a: if the flashback cost was paid, it's exiled instead of going anywhere else as it leaves the stack.
  if (flashback) o.exileOnLeave = true;
  // CR 702.40a: storm counts the spells cast before this one this turn.
  const before = Object.values(g.turnLog.spellsCast).reduce((a, b) => a + b, 0);
  const paid = [...(alt ? [alt.id] : []), ...extras, ...(kicked ? ['kicker'] : [])];
  o.cast = {
    by: player,
    from: fromCommandZone ? 'command' : flashback || escape ? 'graveyard' : fromExile ? 'exile' : 'hand',
    before,
    ...(kicked ? { kicked: true as const } : {}),
    ...(paid.length ? { paid } : {}),
  };
  g.stack.push({ kind: 'spell', object: id, controller: player, x, targets, ...(program ? { program } : {}) });
  events.push({ type: 'cast', player, object: id });
  announceTargets(g.stack[g.stack.length - 1]!, events);
  // CR 601.2i: a player who had priority when casting gets priority afterward.
  givePriority(g, player);
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
}

function activate(g: GameState, player: PlayerId, id: ObjectId, index: number, choices: ActivationChoices, events: GameEvent[]): void {
  const o = obj(g, id);
  // CR 602.2: only an object's controller (or owner, outside the battlefield) can activate its abilities.
  const yours = o.zone === 'battlefield' ? o.controller === player : (o.zone === 'hand' || o.zone === 'graveyard') && o.owner === player;
  if (!yours) throw new RulesError('You can’t activate abilities of that object.');
  const ability: ActivatedAbility | undefined = activatedAbilities(g, o)[index];
  if (!ability) throw new RulesError(`${nameOf(g, o)} has no such ability.`);
  const name = nameOf(g, o);
  const sorcerySpeed = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;
  const { cost } = ability;

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
  if (cost.tap) {
    // CR 118.3 / CR 302.6
    if (o.tapped) throw new RulesError(`${name} is already tapped.`);
    if (!canUseTapAbilities(g, o)) throw new RulesError(`${name} hasn’t been under your control since your turn began.`);
  }
  if (cost.untap && !o.tapped) throw new RulesError(`${name} is already untapped.`);
  checkOtherCosts(g, player, o, cost, choices.costs);

  // CR 602.2b (following CR 601.2b–c): modes and targets.
  const program = flatten([ability], choices.modes);
  const targets = chooseTargets(g, player, program.specs, choices.targets, o);
  const source = { id, zcc: o.zcc };

  // CR 602.2b (following CR 601.2g–h): mana abilities, then the whole cost is paid.
  const mana = parseManaCost(cost.mana ?? '');
  if (!Number.isInteger(choices.x) || choices.x < 0) throw new RulesError('X must be a whole number, 0 or more.');
  if (mana.unsupported.length) throw new RulesError(`Paying ${mana.unsupported.map((s) => `{${s}}`).join('')} isn’t supported yet.`);
  // Permanents the cost itself taps or sacrifices can't also be tapped for mana.
  const usesItself = [...(cost.tap || cost.other?.some((c) => c.type === 'sacrifice_self') ? [id] : []), ...(choices.costs.sacrifice ?? [])];
  if (cost.mana && choices.autoTap) autoTap(g, player, mana, choices.x, events, usesItself);
  if (cost.mana) {
    const left = payFromPool(g.players[player]!.pool, mana, choices.x);
    if (!left) throw new RulesError('Not enough mana to activate that.');
    g.players[player]!.pool = left;
  }
  if (cost.tap) setTapped(g, id, true, events);
  if (cost.untap) setTapped(g, id, false, events);
  if (cost.loyalty !== undefined) {
    // CR 606.4: the cost is putting on or removing loyalty counters.
    o.counters.loyalty = (o.counters.loyalty ?? 0) + cost.loyalty;
    o.loyaltyActivatedTurn = g.turn;
    events.push({ type: 'counters', object: id, counter: 'loyalty', delta: cost.loyalty });
  }
  if (ability.oncePerTurn) (o.activatedTurn ??= {})[index] = g.turn;
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
  });
  events.push({ type: 'ability_activated', player, source: id, text: ability.text });
  announceTargets(g.stack[g.stack.length - 1]!, events);
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
    events.push({ type: 'counters', object: id, counter: 'loyalty', delta });
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
      if (!canUseTapAbilities(g, o)) throw new RulesError(`${face.name} hasn’t been under your control since your turn began.`);
    }
    if (mana) {
      const cost = parseManaCost(mana);
      if (wantsAutoTap) autoTap(g, player, cost, 0, events);
      const left = payFromPool(g.players[player]!.pool, cost);
      if (!left) throw new RulesError('Not enough mana to activate that.');
      g.players[player]!.pool = left;
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
  events.push({ type: 'ability_activated', player, source: id, text: line });
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

