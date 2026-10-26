import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, manaAbilities } from './characteristics.js';
import {
  checkStateBasedActions,
  completeManualResolution,
  finishCleanup,
  givePriority,
  passPriority,
  playerLoses,
  settle,
} from './flow.js';
import { parseManaCost, payFromPool, type ManaCost } from './mana.js';
import { runEffect } from './registry.js';
import { answerOpening } from './setup.js';
import {
  RulesError,
  type Action,
  type ApplyResult,
  type ChoiceAnswer,
  type GameEvent,
  type GameState,
  type ManaColor,
  type ManualOp,
  type ObjectId,
  type PlayerId,
} from './types.js';
import { drawCard, faceOf, moveObject, nameOf, obj, setTapped, zoneList } from './zones.js';

/**
 * Applies one player action. Pure: the input state is never modified.
 * CR 733.1: an illegal action is reversed entirely — here, by returning an error
 * and leaving the original state untouched.
 */
export function apply(state: GameState, action: Action): ApplyResult {
  const g = structuredClone(state);
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
      return activateMana(g, a.player, a.object, a.ability, a.choice, events);
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
    case 'cast':
      return cast(g, a.player, a.object, a.face ?? 0, a.x ?? 0, a.autoTap ?? false, events);
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

  switch (p.kind) {
    case 'mulligan':
    case 'bottom_cards':
      answerOpening(g, player, answer, events);
      return;
    case 'discard_to_hand_size': {
      const ids = (answer as { objects: ObjectId[] }).objects;
      const hand = zoneList(g, 'hand', player);
      if (ids.length !== p.count || new Set(ids).size !== ids.length || !ids.every((id) => hand.includes(id))) {
        throw new RulesError(`Choose exactly ${p.count} card(s) from your hand to discard.`);
      }
      g.pending = null;
      // CR 514.1: the active player discards down to their maximum hand size.
      for (const id of ids) moveObject(g, id, 'graveyard', events);
      finishCleanup(g, events);
      return;
    }
    case 'legend_rule': {
      const keep = (answer as { keep: ObjectId }).keep;
      if (!p.objects.includes(keep)) throw new RulesError('Choose one of the legendary permanents to keep.');
      g.pending = null;
      // CR 704.5j: the rest go to their owners' graveyards.
      for (const id of p.objects) if (id !== keep) moveObject(g, id, 'graveyard', events);
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
  }
}

// ---------------------------------------------------------------------------
// Lands
// ---------------------------------------------------------------------------

function playLand(g: GameState, player: PlayerId, id: ObjectId, faceIndex: number, events: GameEvent[]): void {
  const o = obj(g, id);
  const def = g.cards[o.card]!;
  const face = def.faces[faceIndex];
  if (!face) throw new RulesError('That card has no such face.');
  if (o.zone !== 'hand' || o.owner !== player) throw new RulesError('You can only play lands from your hand.');
  if (!face.types.includes('Land')) throw new RulesError(`${face.name} isn’t a land.`);
  // CR 712.12: a modal double-faced card is played as a land with a land face up.
  if (faceIndex > 0 && def.layout !== 'modal_dfc') throw new RulesError('Only modal double-faced cards can be played back face up.');
  // CR 305.1: during your main phase, with the stack empty.
  if (g.active !== player) throw new RulesError('You can only play lands during your own turn.');
  if (g.step !== 'main1' && g.step !== 'main2') throw new RulesError('Lands can only be played during a main phase.');
  if (g.stack.length > 0) throw new RulesError('Lands can only be played while the stack is empty.');
  // CR 305.2: normally one land per turn.
  if (g.players[player]!.landsPlayedThisTurn >= 1) throw new RulesError('You’ve already played a land this turn.');

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
): void {
  // CR 605.3a: mana abilities can be activated with priority, or while something asks for a mana payment.
  const resolving = g.pending?.kind === 'manual_resolution' && g.pending.player === player;
  if (!resolving) {
    if (g.pending) throw new RulesError(`Waiting for ${g.players[g.pending.player]!.name} to choose.`);
    if (g.priority !== player) throw new RulesError('You don’t have priority.');
  }
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
  const pool = g.players[player]!.pool;
  if (ability.cost.mana) {
    const left = payFromPool(pool, parseManaCost(ability.cost.mana));
    if (!left) throw new RulesError('Not enough mana in your pool to activate that.');
    g.players[player]!.pool = left;
  }
  if (ability.cost.tap) setTapped(g, id, true, events);
  if (ability.cost.untap) setTapped(g, id, false, events);

  // CR 605.3b: mana abilities don't use the stack; they resolve immediately.
  for (const e of ability.effects) {
    const ok = runEffect(e, { g, controller: player, source: o, ...(choice !== undefined ? { choice } : {}), events });
    if (!ok) throw new RulesError('Choose which mana to add.');
  }
  // CR 117.3c: a player who activates an ability receives priority afterward.
  if (!resolving) givePriority(g, player);
}

function autoTap(g: GameState, player: PlayerId, cost: ManaCost, x: number, events: GameEvent[]): void {
  // CR 601.2g: the player gets a chance to activate mana abilities before paying.
  const plan = planAutoTap(g, player, cost, x);
  if (!plan) throw new RulesError('You don’t have enough untapped mana sources.');
  for (const step of plan) activateMana(g, player, step.object, step.ability, step.choice, events);
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

/** Layouts whose non-front faces can be cast. */
const CASTABLE_ALT_FACES = new Set(['split', 'modal_dfc', 'adventure']);

function cast(
  g: GameState,
  player: PlayerId,
  id: ObjectId,
  faceIndex: number,
  x: number,
  wantsAutoTap: boolean,
  events: GameEvent[],
): void {
  const o = obj(g, id);
  const def = g.cards[o.card]!;
  const face = def.faces[faceIndex];
  if (!face) throw new RulesError('That card has no such face.');
  // CR 601.3: casting from anywhere other than your hand needs a rule or effect that allows it.
  if (o.zone !== 'hand' || o.owner !== player) throw new RulesError('You can only cast spells from your hand.');
  // CR 712.11: double-faced cards are cast front face up. CR 709.3 / CR 715.3: split and adventure cards choose a half.
  if (faceIndex > 0 && !CASTABLE_ALT_FACES.has(def.layout)) throw new RulesError(`${face.name} can’t be cast.`);
  // CR 305.9: a land can't be cast as a spell.
  if (face.types.includes('Land')) throw new RulesError(`${face.name} is a land. Play it instead.`);
  if (!Number.isInteger(x) || x < 0) throw new RulesError('X must be a whole number, 0 or more.');

  // CR 117.1a: instants any time you have priority; anything else during your main phase with an empty stack.
  // CR 702.8a: flash lets a card be cast any time you could cast an instant.
  const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
  if (!instantSpeed) {
    if (g.active !== player || (g.step !== 'main1' && g.step !== 'main2') || g.stack.length > 0) {
      throw new RulesError(`${face.name} can only be cast during your main phase while the stack is empty.`);
    }
  }

  const cost = parseManaCost(face.manaCost);
  if (cost.unsupported.length) {
    throw new RulesError(`Paying ${cost.unsupported.map((s) => `{${s}}`).join('')} isn’t supported yet. Use manual moves for this card.`);
  }
  if (wantsAutoTap) autoTap(g, player, cost, x, events);

  // CR 601.2h: pay the total cost; partial payments aren't allowed.
  const left = payFromPool(g.players[player]!.pool, cost, x);
  if (!left) throw new RulesError(`Not enough mana to cast ${face.name}.`);
  g.players[player]!.pool = left;

  // CR 601.2a: the card moves to the stack and its caster becomes its controller.
  moveObject(g, id, 'stack', events, { controller: player, face: faceIndex });
  g.stack.push({ kind: 'spell', object: id, controller: player, x });
  events.push({ type: 'cast', player, object: id });
  // CR 601.2i: a player who had priority when casting gets priority afterward.
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

