import { hasRule, hasType, isPermanentCard, hasKeyword, toughness } from './characteristics.js';
import { needsSecondDamageStep, newCombat, promptAttackers, promptNextBlocker, startBlockers, startCombatDamage } from './combat.js';
import { emptyPool } from './mana.js';
import { canAttach, destroy } from './permanents.js';
import { recheckTargets, runResolution, startResolution } from './resolve.js';
import { evalCondition, newTurnLog } from './conditions.js';
import { applyControlEffects } from './control.js';
import { playerRule } from './player-rules.js';
import { promptAsEnters } from './as-enters.js';
import { collectTriggers, stackTriggers, triggerContext } from './triggers.js';
import type { ChoiceAnswer, GameEvent, GameObject, GameState, PlayerId, Step, StackEntry } from './types.js';
import { STEPS } from './types.js';
import { drawCard, faceOf, livePlayers, moveObject, nameOf, nextPlayer, obj, setTapped, zoneList } from './zones.js';

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
    if (promptAsEnters(g)) return;
    applyControlEffects(g, events);
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
    const src = g.objects[link.source.id];
    if (src && src.zone === 'battlefield' && src.zcc === link.source.zcc) continue;
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
    const ok = source ? evalCondition(entry.condition, triggerContext(g, entry.controller, source, entry.trigger ?? {})) : false;
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
  if (entry.program?.specs.length) {
    // CR 608.3b: a permanent spell with a target (an Aura) checks it; if it's illegal, the spell doesn't resolve.
    const targets = recheckTargets(g, entry);
    const target = targets?.[0]?.[0];
    const enchanted = target?.kind === 'object' ? g.objects[target.id] : undefined;
    if (!enchanted) {
      moveObject(g, o.id, 'graveyard', events);
      events.push({ type: 'fizzled', entry });
      finishResolution(g, entry, events);
      return;
    }
    // CR 608.3c: an Aura spell enters attached to the object it targeted.
    moveObject(g, o.id, 'battlefield', events, { controller: entry.controller });
    o.attachedTo = { id: enchanted.id, zcc: enchanted.zcc };
    events.push({ type: 'attached', object: o.id, to: enchanted.id });
    finishResolution(g, entry, events);
    return;
  }
  // CR 608.3a: a permanent spell with no targets enters the battlefield under its controller's control.
  moveObject(g, o.id, 'battlefield', events, { controller: entry.controller, x: entry.x });
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
  // CR 608.2n: as the final part of an instant or sorcery's resolution, it goes to its owner's graveyard.
  moveObject(g, o.id, 'graveyard', events);
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

/** Ends the current step and moves on. */
export function endStep(g: GameState, events: GameEvent[]): void {
  // CR 500.5: unspent mana empties as each step and phase ends.
  for (const p of Object.values(g.players)) p.pool = emptyPool();
  if (g.step === 'cleanup') {
    if (g.extraCleanup) {
      // CR 514.3a: after players act in a cleanup step, another cleanup step follows.
      beginStep(g, 'cleanup', events);
      return;
    }
    beginTurn(g, nextPlayer(g, g.active), events);
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
  beginStep(g, next ?? 'cleanup', events);
}

export function beginTurn(g: GameState, player: PlayerId, events: GameEvent[]): void {
  // Remember last turn's spells (werewolves, CR 702.145-style conditions); start a fresh log.
  g.lastTurnSpells = g.turnLog.spellsCast;
  g.turnLog = newTurnLog();
  g.turn++;
  g.active = player;
  g.extraCleanup = false;
  // CR 305.2: one land per turn — the count restarts each turn.
  for (const p of Object.values(g.players)) p.landsPlayedThisTurn = 0;
  events.push({ type: 'turn_began', turn: g.turn, player });
  beginStep(g, 'untap', events);
}

export function beginStep(g: GameState, step: Step, events: GameEvent[]): void {
  g.step = step;
  g.priority = null;
  g.passed = [];
  events.push({ type: 'step', step });

  switch (step) {
    case 'untap': {
      for (const id of g.zones.battlefield) {
        const o = g.objects[id]!;
        if (o.controller !== g.active) continue;
        // CR 302.6: permanents the active player controls have now been controlled since this turn began.
        o.sick = false;
        // CR 502.3: the active player untaps their permanents, unless an effect says otherwise.
        if (!hasRule(g, o, 'doesnt_untap')) setTapped(g, id, false, events);
      }
      // CR 502.4: no priority in the untap step.
      beginStep(g, 'upkeep', events);
      return;
    }
    case 'draw': {
      // CR 103.8a: in a two-player game the starting player skips the draw step of their first turn.
      // CR 103.8c: in other multiplayer games, nobody skips it.
      const skip = g.turn === 1 && g.order.length === 2;
      // CR 504.1: the active player draws a card — unless they skip it (CR 614.10: "Skip your draw step" is
      // "instead of drawing, do nothing"; the step still happens for priority).
      if (!skip && !playerRule(g, g.active, 'skip_draw')) drawCard(g, g.active, events);
      break;
    }
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
      startBlockers(g);
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

function startCleanup(g: GameState, events: GameEvent[]): void {
  g.extraCleanup = false;
  // CR 514.1 / CR 402.2: discard down to maximum hand size.
  const hand = zoneList(g, 'hand', g.active);
  const excess = hand.length - g.config.maxHandSize;
  if (excess > 0 && !playerRule(g, g.active, 'no_max_hand_size')) {
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
  }
  g.effects = g.effects.filter((e) => e.until !== 'eot' && e.objects.some((r) => g.objects[r.id]?.zcc === r.zcc));
  g.prevention = [];
  applyControlEffects(g, events);
  // CR 514.3a: if state-based actions happen now, players get priority and another cleanup step follows.
  const acted = checkStateBasedActions(g, events);
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
export function checkStateBasedActions(g: GameState, events: GameEvent[]): boolean {
  let any = false;
  for (let round = 0; round < 100; round++) {
    // Events from the previous round can trigger abilities (and leaving objects look back, CR 603.10a).
    collectTriggers(g, events);
    const losers: { player: PlayerId; reason: string }[] = [];
    const toGraveyard = new Set<string>();
    const toDestroy = new Set<string>();
    const unattach: string[] = [];
    const vanish: string[] = [];
    let changed = false;

    for (const p of livePlayers(g)) {
      const ps = g.players[p]!;
      // "You can't lose the game." (CR 104.3a: conceding still works.)
      if (playerRule(g, p, 'cant_lose')) {
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
      const face = faceOf(g, o);
      if (face.subtypes.includes('Aura') && face.keywords.some((k) => k.id === 'enchant' && k.filter)) {
        // CR 704.5m: an Aura attached illegally, or to nothing, goes to its owner's graveyard.
        const to = o.attachedTo && g.objects[o.attachedTo.id];
        if (!to || to.zcc !== o.attachedTo!.zcc || !canAttach(g, o, to)) toGraveyard.add(id);
      } else if (o.attachedTo && face.subtypes.includes('Equipment')) {
        // CR 704.5n: an Equipment attached illegally becomes unattached and stays on the battlefield.
        const to = g.objects[o.attachedTo.id];
        if (!to || to.zcc !== o.attachedTo.zcc || !canAttach(g, o, to)) unattach.push(id);
      }
    }

    // CR 704.5j: the legend rule — needs the controller's choice, handled one group at a time.
    const legendGroup = findLegendRuleGroup(g, toGraveyard);

    if (!losers.length && !toGraveyard.size && !toDestroy.size && !unattach.length && !vanish.length && !changed && !legendGroup) {
      return any;
    }
    any = true;

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
    if (!faceOf(g, o).supertypes.includes('Legendary')) continue;
    const key = `${o.controller}\u0000${nameOf(g, o)}`;
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
  delete g.objects[id];
}

// ---------------------------------------------------------------------------
// Leaving the game
// ---------------------------------------------------------------------------

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
    promptNextBlocker(g);
    if (!g.pending) givePriority(g, g.active);
  }
  g.passed = g.passed.filter((p) => p !== player);
  // Simplification until the full multiplayer turn rules land: if the active player leaves,
  // their turn ends and the next player's turn begins.
  if (g.active === player && g.started) {
    g.stack = [];
    for (const p of Object.values(g.players)) p.pool = emptyPool();
    beginTurn(g, nextPlayer(g, player), events);
  }
}
