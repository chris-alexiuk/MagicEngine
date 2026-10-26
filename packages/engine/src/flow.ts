import { isPermanentCard, hasKeyword, hasType, toughness } from './characteristics.js';
import { emptyPool } from './mana.js';
import { canAutomate, runEffect } from './registry.js';
import type { GameEvent, GameObject, GameState, PlayerId, Step, StackEntry } from './types.js';
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
 * state-based actions before anyone receives priority (CR 117.5 / CR 704.3).
 */
export function settle(g: GameState, events: GameEvent[]): void {
  for (let guard = 0; guard < 1000; guard++) {
    if (g.over || g.pending || !g.started) return;
    checkStateBasedActions(g, events);
    if (g.over || g.pending) return;
    if (g.priority !== null) {
      if (g.players[g.priority]!.lost) g.priority = nextPlayer(g, g.priority);
      events.push({ type: 'priority', player: g.priority });
      return;
    }
    return;
  }
  throw new Error('settle did not converge');
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

  if (entry.kind === 'ability') {
    g.pending = { kind: 'manual_resolution', player: entry.controller, text: entry.text, sourceName: entry.sourceName };
    return;
  }

  const o = obj(g, entry.object);
  const face = faceOf(g, o);
  if (isPermanentCard(face)) {
    // CR 608.3a: a permanent spell with no targets enters the battlefield under its controller's control.
    moveObject(g, o.id, 'battlefield', events, { controller: entry.controller });
    finishResolution(g, entry, events);
    return;
  }

  const spellAbilities = face.abilities.filter((a) => a.kind === 'spell');
  const automatic = face.unparsed.length === 0 && spellAbilities.every((a) => canAutomate(a));
  if (automatic) {
    // CR 608.2c: follow the instructions in the order written.
    for (const a of spellAbilities) for (const e of a.effects) runEffect(e, { g, controller: entry.controller, source: o, events });
    toGraveyardAfterResolving(g, o, events);
    finishResolution(g, entry, events);
  } else {
    g.pending = { kind: 'manual_resolution', player: entry.controller, text: face.oracle, sourceName: face.name };
  }
}

/** Called when a manual resolution is confirmed. */
export function completeManualResolution(g: GameState, events: GameEvent[]): void {
  const entry = g.stack[g.stack.length - 1];
  g.pending = null;
  if (!entry) return;
  if (entry.kind === 'spell') {
    const o = g.objects[entry.object];
    if (o && o.zone === 'stack') toGraveyardAfterResolving(g, o, events);
  } else {
    g.stack.pop();
  }
  finishResolution(g, entry, events);
}

function toGraveyardAfterResolving(g: GameState, o: GameObject, events: GameEvent[]): void {
  // CR 608.2n: as the final part of an instant or sorcery's resolution, it goes to its owner's graveyard.
  moveObject(g, o.id, 'graveyard', events);
}

function finishResolution(g: GameState, entry: StackEntry, events: GameEvent[]): void {
  g.stack = g.stack.filter((e) => e !== entry && !(entry.kind === 'spell' && e.kind === 'spell' && e.object === entry.object));
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
  // CR 508.8: if no creatures are declared as attackers, skip the declare blockers and combat damage steps.
  // Attacking arrives in a later milestone, so no creature is ever declared as an attacker yet.
  if (next === 'declare_blockers') next = 'end_of_combat';
  beginStep(g, next ?? 'cleanup', events);
}

export function beginTurn(g: GameState, player: PlayerId, events: GameEvent[]): void {
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
        // CR 502.3: the active player untaps their permanents.
        setTapped(g, id, false, events);
      }
      // CR 502.4: no priority in the untap step.
      beginStep(g, 'upkeep', events);
      return;
    }
    case 'draw': {
      // CR 103.8a: in a two-player game the starting player skips the draw step of their first turn.
      // CR 103.8c: in other multiplayer games, nobody skips it.
      const skip = g.turn === 1 && g.order.length === 2;
      // CR 504.1: the active player draws a card.
      if (!skip) drawCard(g, g.active, events);
      break;
    }
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
  if (excess > 0) {
    g.pending = { kind: 'discard_to_hand_size', player: g.active, count: excess };
    return;
  }
  finishCleanup(g, events);
}

export function finishCleanup(g: GameState, events: GameEvent[]): void {
  // CR 514.2: damage wears off and "until end of turn" effects end.
  for (const id of g.zones.battlefield) g.objects[id]!.damage = 0;
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
    const losers: { player: PlayerId; reason: string }[] = [];
    const toGraveyard = new Set<string>();
    const vanish: string[] = [];
    let changed = false;

    for (const p of livePlayers(g)) {
      const ps = g.players[p]!;
      // CR 704.5a: 0 or less life loses.
      if (ps.life <= 0) losers.push({ player: p, reason: 'life total 0 or less' });
      // CR 704.5b: attempted to draw from an empty library.
      else if (ps.drewFromEmptyLibrary) losers.push({ player: p, reason: 'drew from an empty library' });
      // CR 704.5c: ten or more poison counters.
      else if (ps.poison >= 10) losers.push({ player: p, reason: 'ten poison counters' });
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
        else if (o.damage >= t && !hasKeyword(g, o, 'indestructible')) toGraveyard.add(id);
      }
      // CR 704.5i: a planeswalker with 0 loyalty goes to the graveyard.
      if (hasType(g, o, 'Planeswalker') && (o.counters.loyalty ?? 0) <= 0) toGraveyard.add(id);
    }

    // CR 704.5j: the legend rule — needs the controller's choice, handled one group at a time.
    const legendGroup = findLegendRuleGroup(g, toGraveyard);

    if (!losers.length && !toGraveyard.size && !vanish.length && !changed && !legendGroup) return any;
    any = true;

    for (const id of vanish) removeObjectEntirely(g, id);
    for (const id of toGraveyard) moveObject(g, id, 'graveyard', events);
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
  if (g.pending && g.pending.player === player) g.pending = null;

  const remaining = livePlayers(g);
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
  g.passed = g.passed.filter((p) => p !== player);
  // Simplification until the full multiplayer turn rules land: if the active player leaves,
  // their turn ends and the next player's turn begins.
  if (g.active === player && g.started) {
    g.stack = [];
    for (const p of Object.values(g.players)) p.pool = emptyPool();
    beginTurn(g, nextPlayer(g, player), events);
  }
}
