import { dredgeOptions } from './dredge.js';
import { phasingStep } from './phasing.js';
import { checkDungeonDone } from './dungeons.js';
import type { ConditionNode } from '@mtg/schema';
import { chars, hasRule, hasType, isPermanentCard, hasKeyword, printedAbilities, toughness, withCharsCache } from './characteristics.js';
import { needsSecondDamageStep, newCombat, promptAttackers, promptNextBlocker, startBlockers, startCombatDamage } from './combat.js';
import { emptyPool } from './mana.js';
import { canAttach, canEnchantPlayer, destroy } from './permanents.js';
import { recheckTargets, runResolution, startResolution } from './resolve.js';
import { evalCondition, newTurnLog } from './conditions.js';
import { applyControlEffects } from './control.js';
import { keptManaColors, legendRuleExempt, manaBecomes, maxHandSize, playerRule } from './player-rules.js';
import { promptAsEnters } from './as-enters.js';
import { checkDayNight, syncDayNight } from './day-night.js';
import { preparedSource } from './prepare.js';
import { ascendOnResolve, checkDesignations } from './designations.js';
import { prunePermissions } from './permissions.js';
import { addLore, sagaDone } from './sagas.js';
import { collectTriggers, stackTriggers, triggerContext } from './triggers.js';
import type { ChoiceAnswer, GameEvent, GameObject, GameState, ManaColor, PlayerId, RestrictedMana, Step, StackEntry } from './types.js';
import { STEPS } from './types.js';
import { drawCard, faceOf, livePlayers, moveObject, nameOf, nextPlayer, obj, pairedPartner, setTapped, zoneList } from './zones.js';

// ---------------------------------------------------------------------------
// Priority and settling
// ---------------------------------------------------------------------------

/** Steps in which no player normally receives priority. */
function stepHasPriority(step: Step): boolean {
  // CR 502.4: no player receives priority during the untap step.
  // CR 514.3: normally no player receives priority during the cleanup step.
  return step !== 'untap' && step !== 'cleanup';
}

export function givePriority(g: GameState, player: PlayerId): void {
  g.priority = player;
  g.passed = [];
}

/**
 * Runs everything the game does on its own until a player has to act:
 * state-based actions, then triggered abilities go on the stack, before anyone
 * receives priority (CR 117.5).
 */
export function settle(g: GameState, events: GameEvent[]): void {
  for (let guard = 0; guard < 1000; guard++) {
    if (g.over) return;
    returnExiledUntil(g, events);
    collectTriggers(g, events);
    if (g.pending || !g.started) return;
    // CR 614.12: choices for permanents that just entered ("As ~ enters, …").
    if (promptAsEnters(g, events)) return;
    applyControlEffects(g, events);
    // CR 702.145c/d/f/g: day and night follow daybound and nightbound permanents.
    syncDayNight(g, events);
    // CR 702.179a: speed; CR 702.131b: the city's blessing.
    checkDesignations(g, events);
    checkStateBasedActions(g, events);
    if (g.over || g.pending) return;
    if (returnExiledUntil(g, events)) continue;
    if (g.priority === null) return;
    if (g.triggers.length) {
      // CR 117.5: triggered abilities are put on the stack after state-based actions, then check again.
      stackTriggers(g, events);
      if (g.pending) return;
      continue;
    }
    if (g.players[g.priority]!.lost) g.priority = nextPlayer(g, g.priority);
    events.push({ type: 'priority', player: g.priority });
    return;
  }
  throw new Error('settle did not converge');
}

/**
 * CR 610.3: once the permanent leaves the battlefield, what it exiled "until ~ leaves the
 * battlefield" returns — under its owner's control (CR 610.3c). True if anything changed.
 */
function returnExiledUntil(g: GameState, events: GameEvent[]): boolean {
  if (!g.exiledUntil?.length) return false;
  let changed = false;
  for (const link of [...g.exiledUntil]) {
    if (link.monarch) {
      // Palace Jailer: only an opponent becoming the monarch ends it (the controller becoming it doesn't).
      const now = g.monarch ?? null;
      if (now === link.monarch.was) continue;
      if (now === null || now === link.monarch.controller) {
        link.monarch.was = now;
        continue;
      }
    } else {
      const src = g.objects[link.source.id];
      if (src && src.zone === 'battlefield' && src.zcc === link.source.zcc) continue;
    }
    g.exiledUntil = g.exiledUntil.filter((l) => l !== link);
    const o = g.objects[link.object.id];
    if (!o || o.zone !== 'exile' || o.zcc !== link.object.zcc) continue;
    moveObject(g, o.id, 'battlefield', events, { controller: o.owner });
    changed = true;
  }
  return changed;
}

/**
 * A player passes priority. CR 117.3d: priority moves to the next player in turn order.
 * CR 117.4: once all players pass in succession, the top of the stack resolves, or
 * (CR 500.2) with an empty stack the step ends.
 */
export function passPriority(g: GameState, player: PlayerId, events: GameEvent[]): void {
  events.push({ type: 'passed', player });
  if (!g.passed.includes(player)) g.passed.push(player);
  const everyone = livePlayers(g);
  if (everyone.every((p) => g.passed.includes(p))) {
    g.passed = [];
    if (g.stack.length > 0) {
      g.priority = null;
      resolveTop(g, events);
    } else {
      g.priority = null;
      endStep(g, events);
    }
  } else {
    g.priority = nextPlayer(g, player);
  }
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/** CR 608.1: the top of the stack resolves. */
export function resolveTop(g: GameState, events: GameEvent[]): void {
  const entry = g.stack[g.stack.length - 1];
  if (!entry) return;

  // Nothing compiled, or a mode chosen that the compiler couldn't read: its controller resolves it by hand.
  if (entry.kind === 'ability' && (!entry.program || entry.program.manual)) {
    g.pending = { kind: 'manual_resolution', player: entry.controller, text: entry.text, sourceName: entry.sourceName };
    return;
  }

  if (entry.kind === 'spell') {
    const o = obj(g, entry.object);
    const face = faceOf(g, o);
    if (isPermanentCard(face)) {
      resolvePermanentSpell(g, entry, o, events);
      return;
    }
    if (!entry.program || entry.program.manual) {
      g.pending = { kind: 'manual_resolution', player: entry.controller, text: face.oracle, sourceName: face.name };
      return;
    }
  }

  // CR 603.4: an intervening "if" is checked again; if it's false now, the ability does nothing.
  if (entry.kind === 'ability' && entry.condition) {
    const source = g.objects[entry.source.id];
    const ok = source ? evalCondition(entry.condition, { ...triggerContext(g, entry.controller, source, entry.trigger ?? {}), x: entry.x }) : false;
    if (!ok) {
      finishResolution(g, entry, events);
      return;
    }
  }
  const targets = recheckTargets(g, entry);
  if (!targets) {
    // CR 608.2b: every target is illegal, so it doesn't resolve. A spell goes to its owner's graveyard.
    if (entry.kind === 'spell') moveObject(g, entry.object, 'graveyard', events);
    events.push({ type: 'fizzled', entry });
    finishResolution(g, entry, events);
    return;
  }
  // CR 702.131a: ascend on an instant or sorcery is a spell ability (printed first).
  if (entry.kind === 'spell' && faceOf(g, obj(g, entry.object)).keywords.some((k) => k.id === 'ascend')) ascendOnResolve(g, entry.controller, events);
  startResolution(g, entry, targets);
  continueResolution(g, events);
}

/** Runs (or resumes, with a player's answer) the resolving spell or ability. */
export function continueResolution(g: GameState, events: GameEvent[], answer?: ChoiceAnswer): void {
  const entry = g.resolving!.entry;
  if (!runResolution(g, events, answer)) return;
  if (entry.kind === 'spell') {
    const o = g.objects[entry.object];
    if (o && o.zone === 'stack') toGraveyardAfterResolving(g, o, events);
  }
  finishResolution(g, entry, events);
}

function resolvePermanentSpell(g: GameState, entry: StackEntry & { kind: 'spell' }, o: GameObject, events: GameEvent[]): void {
  // CR 608.3f / 707.10f: a copy of a permanent spell becomes a token as it enters.
  if (o.spellCopy) {
    delete o.spellCopy;
    o.token = true;
  }
  if (entry.program?.specs.length) {
    // CR 608.3b: a permanent spell with a target (an Aura) checks it; if it's illegal, the spell doesn't resolve.
    const targets = recheckTargets(g, entry);
    const target = targets?.[0]?.[0];
    const enchanted = target?.kind === 'object' ? g.objects[target.id] : undefined;
    if (target?.kind === 'player') {
      // CR 303.4: "enchant player" — it enters attached to that player.
      moveObject(g, o.id, 'battlefield', events, { controller: entry.controller });
      o.attachedToPlayer = target.player;
      events.push({ type: 'attached', object: o.id, to: target.player, player: true });
      finishResolution(g, entry, events);
      return;
    }
    if (!enchanted && o.bestowed) {
      // CR 702.103e: a bestowed spell whose target is illegal resolves as an enchantment creature spell.
      delete o.bestowed;
    } else if (!enchanted) {
      moveObject(g, o.id, 'graveyard', events);
      events.push({ type: 'fizzled', entry });
      finishResolution(g, entry, events);
      return;
    } else {
      // CR 608.3c: an Aura spell enters attached to the object it targeted.
      moveObject(g, o.id, 'battlefield', events, { controller: entry.controller });
      o.attachedTo = { id: enchanted.id, zcc: enchanted.zcc };
      // What it does now depends on what it's attached to: anything worked out as it entered is out of date.
      g.clock++;
      events.push({ type: 'attached', object: o.id, to: enchanted.id });
      finishResolution(g, entry, events);
      return;
    }
  }
  // CR 608.3a: a permanent spell with no targets enters the battlefield under its controller's control.
  // CR 702.190b: one whose sneak cost was paid enters tapped and attacking what the returned creature attacked.
  const sneak = o.cast?.paid?.includes('sneak') ? entry.costLKI?.attackTarget : undefined;
  moveObject(g, o.id, 'battlefield', events, { controller: entry.controller, x: entry.x, ...(sneak ? { tapped: true } : {}) });
  if (sneak && g.combat && g.combat.attackersDeclared && hasType(g, o, 'Creature')) g.combat.attackers[o.id] = { zcc: o.zcc, target: { ...sneak }, blocked: false, blockers: [] };
  finishResolution(g, entry, events);
}

/** Called when a manual resolution is confirmed. */
export function completeManualResolution(g: GameState, events: GameEvent[]): void {
  const entry = g.stack[g.stack.length - 1];
  g.pending = null;
  if (!entry) return;
  if (entry.kind === 'spell') {
    const o = g.objects[entry.object];
    if (o && o.zone === 'stack') toGraveyardAfterResolving(g, o, events);
  }
  finishResolution(g, entry, events);
}

function toGraveyardAfterResolving(g: GameState, o: GameObject, events: GameEvent[]): void {
  // CR 707.10a: a copy of a spell that leaves the stack ceases to exist.
  if (o.spellCopy) {
    removeObjectEntirely(g, o.id);
    return;
  }
  // CR 702.27a (buyback): "put this spell into its owner's hand instead of into that player's graveyard".
  const toHand = printedAbilities(faceOf(g, o)).some(
    (a) => a.kind === 'static' && a.effect.type === 'resolve_to_hand' && evalCondition(a.effect.condition as ConditionNode, { g, controller: o.controller, source: o, events: [], targets: [], x: 0, memo: {} }),
  );
  // CR 702.88a (rebound): cast from your hand, it's exiled instead, to be cast again at your next upkeep.
  // Ojer Pakpatiq: a spell that gained rebound.
  const rebound = !toHand && o.cast?.from === 'hand' && (o.reboundGranted === o.zcc || printedAbilities(faceOf(g, o)).some((a) => a.kind === 'static' && a.effect.type === 'rebound'));
  if (rebound) {
    const controller = o.controller;
    moveObject(g, o.id, 'exile', events);
    g.delayed.push({
      id: `d${g.nextId++}`,
      controller,
      source: { id: o.id, zcc: o.zcc },
      sourceName: nameOf(g, o),
      text: 'rebound',
      step: 'upkeep',
      whose: 'you',
      createdTurn: g.turn,
      createdStep: g.step,
      effects: [{ type: 'cast_free', what: { ref: 'self' } }],
      targets: [],
    });
    return;
  }
  // CR 608.2n: as the final part of an instant or sorcery's resolution, it goes to its owner's graveyard.
  moveObject(g, o.id, toHand ? 'hand' : 'graveyard', events);
}

const sameEntry = (a: StackEntry, b: StackEntry) =>
  a === b || (a.kind === 'spell' && b.kind === 'spell' ? a.object === b.object : a.kind === 'ability' && b.kind === 'ability' && a.id === b.id);

function finishResolution(g: GameState, entry: StackEntry, events: GameEvent[]): void {
  // CR 608.2n: an ability is removed from the stack; a spell has already moved.
  g.stack = g.stack.filter((e) => !sameEntry(e, entry));
  events.push({ type: 'resolved', entry });
  // CR 117.3b: the active player receives priority after a spell or ability resolves.
  givePriority(g, g.active);
}

// ---------------------------------------------------------------------------
// Turn structure
// ---------------------------------------------------------------------------

function nextStepAfter(step: Step): Step | null {
  const i = STEPS.indexOf(step);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1]! : null;
}

/**
 * CR 500.8: "After this phase, there is an additional combat phase [followed by an additional main phase]" — the added
 * phases come right after the current one; then the turn carries on where it would have.
 */
function extraPhaseStep(g: GameState, next: Step | null): Step | null {
  const endsPhase = g.step === 'main1' || g.step === 'main2' || g.step === 'end_of_combat';
  if (!endsPhase) return next;
  const x = g.inExtra;
  // The added combat is over: its main phase, if it has one.
  if (x && g.step === 'end_of_combat' && x.main && !x.mainNow) {
    x.mainNow = true;
    return 'main2';
  }
  const queued = g.extraPhases?.shift();
  if (queued) {
    g.inExtra = { main: queued.main, then: x ? x.then : (next ?? 'end') };
    // Moraug: "At the beginning of that combat, …" — a delayed trigger for this phase's beginning of combat step (CR 603.7).
    if (queued.begin) {
      const b = queued.begin;
      g.delayed.push({ id: `d${g.nextId++}`, controller: b.controller, source: b.source, sourceName: b.sourceName, text: `${b.sourceName}: at the beginning of that combat`, step: 'beginning_of_combat', createdTurn: g.turn, createdStep: g.step, effects: b.effects, targets: [] });
    }
    return 'beginning_of_combat';
  }
  if (x) {
    delete g.inExtra;
    return x.then;
  }
  return next;
}

/** Ends the current step and moves on. */
export function endStep(g: GameState, events: GameEvent[]): void {
  // CR 500.5: unspent mana empties as each step and phase ends — except mana an effect says isn't lost until later.
  const combatEnds = g.step === 'end_of_combat';
  for (const p of Object.values(g.players)) {
    // Omnath, Locus of Mana / Electro: "You don't lose unspent green (red) mana as steps and phases end."
    const keep = keptManaColors(g, p.id);
    // Kruphix, God of Horizons: "If you would lose unspent mana, that mana becomes colorless instead." (CR 614.1a)
    const becomes = manaBecomes(g, p.id) as ManaColor | undefined;
    const pool = emptyPool();
    for (const c of keep) pool[c as ManaColor] = p.pool[c as ManaColor];
    if (becomes) for (const c of Object.keys(p.pool) as ManaColor[]) if (!keep.has(c)) pool[becomes] += p.pool[c];
    p.pool = pool;
    const survives = (r: RestrictedMana) => keep.has(r.color) || (r.keep === 'end_of_turn' ? g.step !== 'cleanup' : r.keep === 'end_of_combat' ? !combatEnds : false);
    const kept = (p.restricted ?? []).flatMap((r) => {
      if (survives(r)) return [r];
      const { keep: _k, ...rest } = r;
      return becomes ? [{ ...rest, color: becomes }] : [];
    });
    if (kept.length) p.restricted = kept;
    else delete p.restricted;
  }
  if (g.step === 'cleanup') {
    if (g.extraCleanup) {
      // CR 514.3a: after players act in a cleanup step, another cleanup step follows.
      beginStep(g, 'cleanup', events);
      return;
    }
    // CR 500.7: an extra turn comes next (the most recently created first).
    // Trouble in Pairs: "If an opponent would begin an extra turn, that player skips that turn instead." (CR 614.10)
    const takeExtra = () => {
      while (g.extraTurns?.length && (g.players[g.extraTurns[0]!]?.lost || playerRule(g, g.extraTurns[0]!, 'skip_extra_turns'))) g.extraTurns.shift();
      return g.extraTurns?.shift();
    };
    let base = g.active;
    let extra = takeExtra();
    let player = extra ?? nextPlayer(g, base);
    // CR 614.10: "Target opponent skips their next turn" — the next turn that player would take, then the one after it.
    for (let guard = 0; guard < 1000 && g.players[player]?.skipNext?.turn; guard++) {
      g.players[player]!.skipNext!.turn!--;
      if (extra === undefined) base = player;
      extra = takeExtra();
      player = extra ?? nextPlayer(g, base);
    }
    beginTurn(g, player, events);
    return;
  }
  let next = nextStepAfter(g.step);
  if (g.step === 'declare_attackers' && g.combat && Object.keys(g.combat.attackers).length === 0) {
    // CR 508.8: no attackers — skip the declare blockers and combat damage steps.
    next = 'end_of_combat';
  }
  if (g.step === 'combat_damage' && needsSecondDamageStep(g)) {
    // CR 510.4: after a first-strike damage step, the phase gets a second combat damage step.
    next = 'combat_damage';
  }
  if (g.step === 'end_of_combat') {
    // CR 511.3: as the end of combat step ends, everything is removed from combat.
    g.combat = null;
  }
  next = extraPhaseStep(g, next);
  // CR 614.10: "That player skips their next combat phase" — on to what would follow it.
  while (next === 'beginning_of_combat' && takeSkip(g, 'combat')) {
    g.step = 'end_of_combat';
    next = extraPhaseStep(g, 'main2');
  }
  beginStep(g, next ?? 'cleanup', events);
}

/** CR 614.10: uses up one of the active player's pending skips of that kind, if they have one. */
function takeSkip(g: GameState, kind: 'untap' | 'draw' | 'combat'): boolean {
  const sk = g.players[g.active]?.skipNext;
  if (!sk) return false;
  if (kind === 'combat' && sk.combatThisTurn !== undefined) {
    const now = sk.combatThisTurn === g.turn;
    delete sk.combatThisTurn;
    if (now) return true;
  }
  if (!sk[kind]) return false;
  sk[kind]!--;
  return true;
}

export function beginTurn(g: GameState, player: PlayerId, events: GameEvent[]): void {
  delete g.extraPhases;
  delete g.inExtra;
  // Remember last turn's spells (werewolves, CR 702.145-style conditions); start a fresh log.
  g.lastTurnSpells = g.turnLog.spellsCast;
  // CR 731.2: how many spells the previous turn's active player cast, for day and night.
  const previousCasts = g.turn > 0 ? (g.turnLog.spellsCast[g.active] ?? 0) : undefined;
  g.turnLog = newTurnLog();
  g.turn++;
  g.active = player;
  g.players[player]!.turnsBegun = (g.players[player]!.turnsBegun ?? 0) + 1;
  g.extraCleanup = false;
  // CR 305.2: one land per turn — the count restarts each turn.
  for (const p of Object.values(g.players)) p.landsPlayedThisTurn = 0;
  // "You may play that card this turn" ends with the turn.
  prunePermissions(g);
  // "until your next turn" effects end as that turn begins.
  if (g.effects.some((e) => e.untilTurnOf === player)) g.effects = g.effects.filter((e) => e.untilTurnOf !== player);
  // CR 701.15a: goad lasts until the goading player's next turn.
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.goadedBy?.includes(player)) {
      o.goadedBy = o.goadedBy.filter((p) => p !== player);
      if (!o.goadedBy.length) delete o.goadedBy;
    }
  }
  events.push({ type: 'turn_began', turn: g.turn, player });
  // CR 502.2: the untap step's second part (there's no phasing to do first) — day and night.
  checkDayNight(g, previousCasts, events);
  beginStep(g, 'untap', events);
}

export function beginStep(g: GameState, step: Step, events: GameEvent[]): void {
  g.step = step;
  g.priority = null;
  g.passed = [];
  // CR 702.30a (echo): when the active player's upkeeps began.
  if (step === 'upkeep') {
    const ps = g.players[g.active]!;
    ps.upkeeps = [...(ps.upkeeps ?? []).slice(-1), ++g.clock];
  }
  events.push({ type: 'step', step });
  // Genji Glove, Karlach: "if it's the first combat phase of the turn" — count the combat phases (CR 500.8).
  if (step === 'beginning_of_combat') g.turnLog.combatPhases = (g.turnLog.combatPhases ?? 0) + 1;

  switch (step) {
    case 'untap': {
      // CR 614.10: "skips their next untap step" — nothing happens in it.
      if (takeSkip(g, 'untap')) {
        beginStep(g, 'upkeep', events);
        return;
      }
      // CR 502.1: phasing happens first.
      phasingStep(g, events);
      // CR 502.3: "You may choose not to untap ~" — the active player chooses before untapping.
      const optional = g.zones.battlefield.filter((id) => {
        const o = g.objects[id]!;
        return o.controller === g.active && o.tapped && hasRule(g, o, 'may_not_untap');
      });
      if (optional.length) {
        g.pending = { kind: 'keep_tapped', player: g.active, candidates: optional };
        return;
      }
      untapStep(g, events, []);
      return;
    }
    case 'draw': {
      // CR 103.8a: in a two-player game the starting player skips the draw step of their first turn.
      // CR 103.8c: in other multiplayer games, nobody skips it.
      const skip = g.turn === 1 && g.order.length === 2;
      // CR 504.1: the active player draws a card — unless they skip it (CR 614.10: "Skip your draw step" is
      // "instead of drawing, do nothing"; the step still happens for priority).
      if (!skip && !playerRule(g, g.active, 'skip_draw') && !takeSkip(g, 'draw')) {
        // CR 702.52a: the player may dredge instead.
        const dredge = dredgeOptions(g, g.active);
        if (dredge.length) {
          g.pending = { kind: 'dredge', player: g.active, candidates: dredge };
          return;
        }
        drawCard(g, g.active, events);
      }
      break;
    }
    case 'main1':
      // CR 714.3c: as the precombat main phase begins, a lore counter on each of the active player's Sagas.
      for (const id of [...g.zones.battlefield]) {
        const o = g.objects[id]!;
        if (o.controller === g.active) addLore(g, o, events);
      }
      break;
    case 'beginning_of_combat':
      // CR 507.1: with every opponent defending (CR 802.2), there's no defending player to choose.
      g.combat = newCombat();
      break;
    case 'declare_attackers':
      // CR 508.1: the active player declares attackers before anyone gets priority.
      if (promptAttackers(g)) return;
      break;
    case 'declare_blockers':
      // CR 509.1: the defending players declare blockers before anyone gets priority.
      startBlockers(g, events);
      if (g.pending) return;
      break;
    case 'combat_damage':
      // CR 510.1 / CR 510.2: damage is assigned, then dealt, before anyone gets priority.
      startCombatDamage(g, events);
      if (g.pending) return;
      break;
    case 'cleanup': {
      startCleanup(g, events);
      return;
    }
    default:
      break;
  }
  // CR 117.3a: the active player receives priority at the beginning of most steps.
  if (stepHasPriority(step)) givePriority(g, g.active);
}

/** CR 502.3: the active player untaps their permanents (all but those they chose to keep tapped); then the upkeep. */
export function untapStep(g: GameState, events: GameEvent[], keep: readonly string[]): void {
  // CR 502.3: they untap at once — "Creatures with power 3 or greater don't untap …" (Meekstone) is checked first.
  const held = new Set(g.zones.battlefield.filter((id) => g.objects[id]!.controller === g.active && hasRule(g, g.objects[id]!, 'doesnt_untap')));
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.controller !== g.active) continue;
    // CR 302.6: permanents the active player controls have now been controlled since this turn began.
    o.sick = false;
    // CR 502.3: the active player untaps their permanents, unless an effect says otherwise.
    // CR 701.43b: exerting it any number of times wears off in this one untap step.
    const exerted = o.exerted;
    delete o.exerted;
    if (o.skipUntap) {
      // "It doesn't untap during its controller's next untap step."
      o.skipUntap--;
      if (!o.skipUntap) delete o.skipUntap;
      continue;
    }
    if (exerted) continue;
    // "… doesn't untap … for as long as ~ remains tapped"
    if (o.untapLocks) {
      o.untapLocks = o.untapLocks.filter((l) => {
        const s = g.objects[l.id];
        const there = Boolean(s && s.zone === 'battlefield' && s.zcc === l.zcc);
        return there && (l.while === 'present' || (l.while === 'controlled' ? s!.controller === l.controller : s!.tapped));
      });
      if (o.untapLocks.length) continue;
      delete o.untapLocks;
    }
    // CR 502.3: one its controller chose not to untap.
    if (keep.includes(id)) continue;
    if (!held.has(id)) setTapped(g, id, false, events);
  }
  // Seedborn Muse: "Untap all permanents you control during each other player's untap step."
  for (const p of g.order) {
    if (p === g.active || !playerRule(g, p, 'untap_during_others')) continue;
    for (const id of g.zones.battlefield) {
      const o = g.objects[id]!;
      if (o.controller === p && o.tapped) setTapped(g, id, false, events);
    }
  }
  // Unwinding Clock: "Untap all artifacts you control during each other player's untap step."
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.tapped && o.controller !== g.active && hasRule(g, o, 'untap_during_others')) setTapped(g, id, false, events);
  }
  pruneDurations(g, events);
  // CR 502.4: no priority in the untap step.
  beginStep(g, 'upkeep', events);
}

function startCleanup(g: GameState, events: GameEvent[]): void {
  g.extraCleanup = false;
  // CR 514.1 / CR 402.2: discard down to maximum hand size.
  const hand = zoneList(g, 'hand', g.active);
  const max = maxHandSize(g, g.active);
  const excess = max === null ? 0 : hand.length - max;
  if (excess > 0) {
    g.pending = { kind: 'discard_to_hand_size', player: g.active, count: excess };
    return;
  }
  finishCleanup(g, events);
}

export function finishCleanup(g: GameState, events: GameEvent[]): void {
  // CR 514.2: damage wears off and "until end of turn" effects end (regeneration shields too, CR 701.19a).
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    o.damage = 0;
    delete o.regenShields;
    // "becomes a copy of … until end of turn": it's what it was before.
    if (o.copyRevert) {
      const prev = o.copyRevert[0];
      if (prev) o.copyOf = prev;
      else delete o.copyOf;
      delete o.copyRevert;
    }
  }
  g.effects = g.effects.filter((e) => e.until !== 'eot' && !(e.throughTurn !== undefined && e.throughTurn <= g.turn) && e.objects.some((r) => g.objects[r.id]?.zcc === r.zcc));
  g.prevention = [];
  applyControlEffects(g, events);
  // CR 514.3a: if state-based actions happen now, or abilities trigger (Necromancy: "at the beginning of the next cleanup
  // step"), players get priority and another cleanup step follows.
  const acted = checkStateBasedActions(g, events) || g.triggers.length > 0;
  if (g.over || g.pending) return;
  if (acted) {
    g.extraCleanup = true;
    givePriority(g, g.active);
    return;
  }
  endStep(g, events);
}

// ---------------------------------------------------------------------------
// State-based actions (CR 704)
// ---------------------------------------------------------------------------

/**
 * CR 704.3: performs all applicable state-based actions simultaneously, repeating
 * until none apply. Returns whether any were performed.
 */
/** CR 611.2b: an effect "for as long as ~ remains tapped" ends for good once that object isn't tapped there. */
export function pruneDurations(g: GameState, events: GameEvent[]): boolean {
  const held = (r: { id: string; zcc: number }) => {
    const s = g.objects[r.id];
    return Boolean(s && s.zone === 'battlefield' && s.zcc === r.zcc && s.tapped);
  };
  const before = g.effects.length;
  // Sower of Temptation: for as long as it remains on the battlefield (under your control).
  const present = (r: { id: string; zcc: number; player?: PlayerId }) => {
    const s = g.objects[r.id];
    return Boolean(s && s.zone === 'battlefield' && s.zcc === r.zcc && (!r.player || s.controller === r.player));
  };
  // Promise of Loyalty: "for as long as it has a vow counter on it" — over for an object once it hasn't one (narrowing an
  // effect isn't a state-based action, CR 514.3a).
  for (const e of g.effects) {
    if (!e.whileCounter) continue;
    const still = e.objects.filter((r) => {
      const s = g.objects[r.id];
      return Boolean(s && s.zone === 'battlefield' && s.zcc === r.zcc && (s.counters[e.whileCounter!] ?? 0) > 0);
    });
    if (still.length !== e.objects.length) e.objects = still;
  }
  g.effects = g.effects.filter((e) => (!e.whileTapped || held(e.whileTapped)) && (!e.whilePresent || present(e.whilePresent)) && (!e.whileCounter || e.objects.length > 0));
  if (g.effects.length === before) return false;
  applyControlEffects(g, events);
  return true;
}

export function checkStateBasedActions(g: GameState, events: GameEvent[]): boolean {
  let any = false;
  for (let round = 0; round < 100; round++) {
    if (pruneDurations(g, events)) any = true;
    // Events from the previous round can trigger abilities (and leaving objects look back, CR 603.10a).
    collectTriggers(g, events);
    const losers: { player: PlayerId; reason: string }[] = [];
    const toGraveyard = new Set<string>();
    const toDestroy = new Set<string>();
    const unattach: string[] = [];
    const unbestow = new Set<string>();
    const vanish: string[] = [];
    let changed = false;

    // CR 702.95e: a paired creature that leaves, changes controller, or stops being a creature becomes unpaired.
    for (const id of g.zones.battlefield) {
      const o = g.objects[id]!;
      if (!o.pairedWith) continue;
      const partner = pairedPartner(g, o);
      if (!partner || !chars(g, o).types.includes('Creature') || !chars(g, partner).types.includes('Creature')) {
        delete o.pairedWith;
        if (partner) delete partner.pairedWith;
        changed = true;
      }
    }
    // CR 704.5t: a venture marker on a dungeon's bottommost room, with that room's ability gone, completes it.
    for (const p of livePlayers(g)) if (checkDungeonDone(g, p, events)) changed = true;
    // Checking doesn't change anything that characteristics depend on, so lookups share one cache.
    withCharsCache(() => {
      // CR 104.2b: an effect says a player wins (Laboratory Maniac) — everyone else loses.
      const winner = livePlayers(g).find((p) => g.players[p]!.wonByEffect);
      if (winner) {
        delete g.players[winner]!.wonByEffect;
        // Platinum Angel: "your opponents can't win the game".
        if (!livePlayers(g).some((q) => q !== winner && playerRule(g, q, 'opponents_cant_win'))) {
          for (const q of livePlayers(g)) if (q !== winner && !cantLose(g, q)) losers.push({ player: q, reason: `${g.players[winner]!.name} won the game` });
        }
      }
      for (const p of livePlayers(g)) {
        const ps = g.players[p]!;
        // "You can't lose the game." (CR 104.3a: conceding still works.)
        if (cantLose(g, p)) {
          ps.drewFromEmptyLibrary = false;
          continue;
        }
        // CR 704.5a: 0 or less life loses (unless "you don't lose the game for having 0 or less life").
        if (ps.life <= 0 && !playerRule(g, p, 'no_lose_for_life')) losers.push({ player: p, reason: 'life total 0 or less' });
        // CR 704.5b: attempted to draw from an empty library.
        else if (ps.drewFromEmptyLibrary) losers.push({ player: p, reason: 'drew from an empty library' });
        // CR 704.5c: ten or more poison counters.
        else if (ps.poison >= 10) losers.push({ player: p, reason: 'ten poison counters' });
        // CR 704.6c: in Commander, 21 or more combat damage from the same commander.
        else if (g.config.format === 'commander' && Object.values(g.commanderDamage[p] ?? {}).some((n) => n >= 21)) {
          losers.push({ player: p, reason: '21 combat damage from one commander' });
        }
        ps.drewFromEmptyLibrary = false;
      }

      for (const o of Object.values(g.objects)) {
        // CR 704.5d: a token outside the battlefield ceases to exist.
        if (o.token && o.zone !== 'battlefield') vanish.push(o.id);
        // CR 704.5e: so does a copy of a spell off the stack.
        else if (o.spellCopy && o.zone !== 'stack') vanish.push(o.id);
        // CR 722.3c: a prepare spell's copy stays in exile only while its permanent is prepared.
        else if (o.prepareOf && (o.zone !== 'exile' || !preparedSource(g, o))) vanish.push(o.id);
      }

      for (const id of g.zones.battlefield) {
        const o = g.objects[id]!;
        // CR 704.5q: +1/+1 and -1/-1 counters annihilate in pairs.
        const plus = o.counters['+1/+1'] ?? 0;
        const minus = o.counters['-1/-1'] ?? 0;
        if (plus > 0 && minus > 0) {
          const n = Math.min(plus, minus);
          o.counters['+1/+1'] = plus - n;
          o.counters['-1/-1'] = minus - n;
          changed = true;
        }
        if (hasType(g, o, 'Creature')) {
          const t = toughness(g, o);
          // CR 704.5f: toughness 0 or less goes to the graveyard.
          if (t <= 0) toGraveyard.add(id);
          // CR 704.5g: lethal damage destroys it; CR 702.12b: unless it's indestructible.
          else if (o.damage >= t && !hasKeyword(g, o, 'indestructible')) toDestroy.add(id);
          // CR 704.5h: damage from a deathtouch source destroys it too.
          else if (o.deathtouched && !hasKeyword(g, o, 'indestructible')) toDestroy.add(id);
        }
        delete o.deathtouched;
        // CR 704.5i: a planeswalker with 0 loyalty goes to the graveyard.
        if (hasType(g, o, 'Planeswalker') && (o.counters.loyalty ?? 0) <= 0) toGraveyard.add(id);
        // CR 714.4: a Saga that has finished its chapters is sacrificed.
        if (sagaDone(g, o)) toGraveyard.add(id);
        const face = faceOf(g, o);
        if (face.subtypes.includes('Aura') && face.keywords.some((k) => k.id === 'enchant' && k.player)) {
          // CR 704.5m: an Aura attached to a player who has left, or can't be enchanted by it now.
          if (!o.attachedToPlayer || !canEnchantPlayer(g, o, o.attachedToPlayer)) toGraveyard.add(id);
        } else if (face.subtypes.includes('Aura') && face.keywords.some((k) => k.id === 'enchant' && k.filter)) {
          // CR 704.5m: an Aura attached illegally, or to nothing, goes to its owner's graveyard.
          const to = o.attachedTo && g.objects[o.attachedTo.id];
          // CR 702.103f: a bestowed Aura that's unattached or attached illegally stops being bestowed instead.
          if (!to || to.zcc !== o.attachedTo!.zcc || !canAttach(g, o, to)) (o.bestowed ? unbestow : toGraveyard).add(id);
        } else if (o.becameAura) {
          // Necromancy: an Aura now (CR 704.5m) — attached to nothing, or to anything but the creature it returned, it goes.
          const to = o.attachedTo && g.objects[o.attachedTo.id];
          if (!to || to.zcc !== o.attachedTo!.zcc || !canAttach(g, o, to)) toGraveyard.add(id);
        } else if (o.attachedTo && face.subtypes.includes('Equipment')) {
          // CR 704.5n: an Equipment attached illegally becomes unattached and stays on the battlefield.
          const to = g.objects[o.attachedTo.id];
          if (!to || to.zcc !== o.attachedTo.zcc || !canAttach(g, o, to)) unattach.push(id);
        }
      }
    });

    // CR 704.5j: the legend rule — needs the controller's choice, handled one group at a time.
    const legendGroup = findLegendRuleGroup(g, toGraveyard);

    if (!losers.length && !toGraveyard.size && !toDestroy.size && !unattach.length && !unbestow.size && !vanish.length && !changed && !legendGroup) {
      return any;
    }
    any = true;
    for (const id of unbestow) {
      const o = g.objects[id]!;
      delete o.attachedTo;
      delete o.bestowed;
      g.clock++;
    }

    for (const id of vanish) removeObjectEntirely(g, id);
    for (const id of unattach) delete g.objects[id]!.attachedTo;
    for (const id of toGraveyard) moveObject(g, id, 'graveyard', events);
    for (const id of toDestroy) if (!toGraveyard.has(id)) destroy(g, g.objects[id]!, events);
    for (const l of losers) playerLoses(g, l.player, l.reason, events);
    if (g.over) return true;
    if (legendGroup) {
      g.pending = { kind: 'legend_rule', player: legendGroup.player, name: legendGroup.name, objects: legendGroup.objects };
      return true;
    }
  }
  return any;
}

function findLegendRuleGroup(
  g: GameState,
  leaving: Set<string>,
): { player: PlayerId; name: string; objects: string[] } | null {
  const groups = new Map<string, string[]>();
  for (const id of g.zones.battlefield) {
    if (leaving.has(id)) continue;
    const o = g.objects[id]!;
    // Legendary as printed (or copied), or made legendary — your Ring-bearer (CR 701.54c).
    const legendary = faceOf(g, o).supertypes.includes('Legendary') || (o.ringBearer !== undefined && chars(g, o).supertypes.includes('Legendary'));
    if (!legendary || legendRuleExempt(g, o)) continue;
    // Witness Protection: by the name it has now.
    const key = `${o.controller}\u0000${chars(g, o).name}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const [key, ids] of groups) {
    if (ids.length > 1) {
      const [player, name] = key.split('\u0000') as [string, string];
      return { player, name, objects: ids };
    }
  }
  return null;
}

function removeObjectEntirely(g: GameState, id: string): void {
  const o = g.objects[id];
  if (!o) return;
  if (o.zone === 'stack') g.stack = g.stack.filter((e) => !(e.kind === 'spell' && e.object === id));
  else {
    const list = zoneList(g, o.zone, o.owner);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }
  // CR 702.26b: a phased-out permanent leaves with them too.
  if (o.phasedOut) g.phasedOut = (g.phasedOut ?? []).filter((x) => x !== id);
  delete g.objects[id];
}

// ---------------------------------------------------------------------------
// Leaving the game
// ---------------------------------------------------------------------------

/** "You can't lose the game" (Angel's Grace; Platinum Angel's too). */
export function cantLose(g: GameState, p: PlayerId): boolean {
  return Boolean(playerRule(g, p, 'cant_lose') || playerRule(g, p, 'opponents_cant_win'));
}

/** A player loses and leaves the game (CR 104.3a / CR 800.4a). */
export function playerLoses(g: GameState, player: PlayerId, reason: string, events: GameEvent[]): void {
  const ps = g.players[player]!;
  if (ps.lost) return;
  ps.lost = true;
  events.push({ type: 'player_lost', player, reason });

  // CR 800.4a: objects the player owns leave the game; abilities they control on the stack cease to exist.
  for (const o of Object.values(g.objects)) if (o.owner === player) removeObjectEntirely(g, o.id);
  g.stack = g.stack.filter((e) => e.controller !== player);
  for (const zone of ['library', 'hand', 'graveyard'] as const) g.zones[zone][player] = [];
  const theirChoice = g.pending && g.pending.player === player ? g.pending.kind : null;
  if (theirChoice) g.pending = null;
  if (g.combat) g.combat.toDeclareBlockers = g.combat.toDeclareBlockers.filter((p) => p !== player);

  const remaining = livePlayers(g);
  // CR 726.4: so with the initiative.
  if (g.initiative === player && remaining.length) {
    g.initiative = g.active !== player && remaining.includes(g.active) ? g.active : nextPlayer(g, player);
    events.push({ type: 'initiative', player: g.initiative });
  }
  // CR 725.4: if the monarch leaves the game, the active player becomes the monarch
  // (or, if the active player is the one leaving, the next player in turn order).
  if (g.monarch === player && remaining.length) {
    g.monarch = g.active !== player && remaining.includes(g.active) ? g.active : nextPlayer(g, player);
    events.push({ type: 'monarch', player: g.monarch });
  }
  if (remaining.length <= 1) {
    // CR 104.2a: a player wins once all their opponents have left the game.
    g.winner = remaining[0] ?? null;
    g.over = true;
    g.priority = null;
    events.push({ type: 'game_over', winner: g.winner });
    return;
  }
  // CR 800.4a: if the leaving player had priority, it passes to the next player still in the game.
  if (g.priority === player) g.priority = nextPlayer(g, player);
  if (theirChoice === 'declare_blockers' && g.active !== player) {
    // The next defending player declares; once everyone has, the active player gets priority.
    promptNextBlocker(g, events);
    if (!g.pending) givePriority(g, g.active);
  }
  g.passed = g.passed.filter((p) => p !== player);
  // Simplification until the full multiplayer turn rules land: if the active player leaves,
  // their turn ends and the next player's turn begins.
  if (g.active === player && g.started) {
    g.stack = [];
    for (const p of Object.values(g.players)) {
      p.pool = emptyPool();
      delete p.restricted;
    }
    beginTurn(g, nextPlayer(g, player), events);
  }
}
