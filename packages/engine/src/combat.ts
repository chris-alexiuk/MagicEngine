import { canUseTapAbilities, chars, hasKeyword, hasProtectionFrom, hasRule, hasType, power, toughness } from './characteristics.js';
import {
  RulesError,
  type AttackTarget,
  type CombatState,
  type DamageAssignment,
  type DamageChoice,
  type DamageRecipient,
  type GameEvent,
  type GameObject,
  type GameState,
  type ObjectId,
  type PlayerId,
} from './types.js';
import { faceOf, livePlayers, nameOf, nextPlayer, setTapped } from './zones.js';

// ---------------------------------------------------------------------------
// Who and what is in combat
// ---------------------------------------------------------------------------

export function newCombat(): CombatState {
  return { attackers: {}, blockers: {}, attackersDeclared: false, toDeclareBlockers: [], firstStrikers: null, damageStep: null };
}

/**
 * CR 506.2: in a two-player game the nonactive player defends. CR 903.2 / CR 802.2: multiplayer
 * games here use free-for-all with the attack multiple players option, so every opponent defends.
 */
export function defendingPlayers(g: GameState): PlayerId[] {
  const out: PlayerId[] = [];
  // APNAP order (CR 101.4): the players after the active player, in turn order.
  for (let p = nextPlayer(g, g.active); p !== g.active; p = nextPlayer(g, p)) out.push(p);
  return out.filter((p) => livePlayers(g).includes(p));
}

/** CR 506.4: a creature that left the battlefield (or changed zones) is no longer in combat. */
function stillThere(g: GameState, id: ObjectId, zcc: number): GameObject | null {
  const o = g.objects[id];
  return o && o.zone === 'battlefield' && o.zcc === zcc && hasType(g, o, 'Creature') ? o : null;
}

export function attackingCreatures(g: GameState): GameObject[] {
  if (!g.combat) return [];
  return Object.entries(g.combat.attackers)
    .map(([id, a]) => stillThere(g, id, a.zcc))
    .filter((o): o is GameObject => o !== null);
}

export function blockingCreatures(g: GameState): GameObject[] {
  if (!g.combat) return [];
  return Object.entries(g.combat.blockers)
    .map(([id, b]) => stillThere(g, id, b.zcc))
    .filter((o): o is GameObject => o !== null);
}

/** The player an attack is aimed at: the player, or the planeswalker's controller. */
function defenderOf(g: GameState, target: AttackTarget): PlayerId | null {
  if (target.kind === 'player') return target.player;
  const pw = g.objects[target.object];
  return pw && pw.zone === 'battlefield' ? pw.controller : null;
}

// ---------------------------------------------------------------------------
// Declare attackers (CR 508)
// ---------------------------------------------------------------------------

function canAttack(g: GameState, o: GameObject): boolean {
  return (
    o.zone === 'battlefield' &&
    o.controller === g.active &&
    hasType(g, o, 'Creature') &&
    // CR 508.1a: untapped, not a battle, and haste or under control since the turn began.
    !o.tapped &&
    !hasType(g, o, 'Battle') &&
    canUseTapAbilities(g, o) &&
    // CR 702.3b: a creature with defender can't attack.
    !hasKeyword(g, o, 'defender') &&
    !hasRule(g, o, 'cant_attack')
  );
}

export function attackTargets(g: GameState): AttackTarget[] {
  const defenders = defendingPlayers(g);
  const targets: AttackTarget[] = defenders.map((player) => ({ kind: 'player', player }));
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (defenders.includes(o.controller) && hasType(g, o, 'Planeswalker')) targets.push({ kind: 'planeswalker', object: id });
  }
  return targets;
}

/** Called as the declare attackers step begins. */
export function promptAttackers(g: GameState): boolean {
  const attackers = g.zones.battlefield.filter((id) => canAttack(g, g.objects[id]!));
  if (attackers.length === 0) {
    g.combat!.attackersDeclared = true;
    return false;
  }
  g.pending = { kind: 'declare_attackers', player: g.active, attackers, targets: attackTargets(g) };
  return true;
}

const sameTarget = (a: AttackTarget, b: AttackTarget) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.object === (b as typeof a).object);

export function declareAttackers(
  g: GameState,
  attacks: { attacker: ObjectId; target: AttackTarget }[],
  events: GameEvent[],
): void {
  const legalTargets = attackTargets(g);
  const seen = new Set<ObjectId>();
  for (const { attacker, target } of attacks) {
    const o = g.objects[attacker];
    if (!o || !canAttack(g, o)) throw new RulesError(`${o ? nameOf(g, o) : attacker} can’t attack.`);
    if (seen.has(attacker)) throw new RulesError(`${nameOf(g, o)} is declared twice.`);
    seen.add(attacker);
    // CR 508.1b / CR 802.3: each attacker attacks a defending player or a planeswalker they control.
    if (!legalTargets.some((t) => sameTarget(t, target))) throw new RulesError(`${nameOf(g, o)} can’t attack that.`);
  }

  // CR 508.1d: a creature that "attacks each combat if able" must attack if it can.
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (!seen.has(id) && canAttack(g, o) && hasRule(g, o, 'attacks_each_combat')) {
      throw new RulesError(`${nameOf(g, o)} attacks each combat if able.`);
    }
  }

  for (const { attacker, target } of attacks) {
    const o = g.objects[attacker]!;
    // CR 508.1f: attacking taps the creature; CR 702.20b: unless it has vigilance.
    if (!hasKeyword(g, o, 'vigilance')) setTapped(g, attacker, true, events);
    // CR 508.1k: it becomes an attacking creature.
    g.combat!.attackers[attacker] = { zcc: o.zcc, target, blocked: false, blockers: [] };
  }
  g.combat!.attackersDeclared = true;
  events.push({ type: 'attacks_declared', attacks });
}

// ---------------------------------------------------------------------------
// Declare blockers (CR 509)
// ---------------------------------------------------------------------------

function canBlockAtAll(g: GameState, o: GameObject, player: PlayerId): boolean {
  // CR 509.1a: untapped creatures the defending player controls, not battles; and not ones that "can't block".
  return (
    o.zone === 'battlefield' &&
    o.controller === player &&
    hasType(g, o, 'Creature') &&
    !o.tapped &&
    !hasType(g, o, 'Battle') &&
    !hasRule(g, o, 'cant_block')
  );
}

function colors(g: GameState, o: GameObject): string[] {
  return chars(g, o).colors;
}

/** Evasion abilities that stop this blocker from blocking this attacker (CR 509.1b). */
export function evasionProblem(g: GameState, blocker: GameObject, attacker: GameObject): string | null {
  const a = (k: string) => hasKeyword(g, attacker, k);
  const b = (k: string) => hasKeyword(g, blocker, k);
  const aName = nameOf(g, attacker);
  if (hasRule(g, attacker, 'cant_be_blocked')) return `${aName} can’t be blocked.`;
  // CR 702.16f: an attacker with protection can't be blocked by creatures with that quality.
  if (hasProtectionFrom(g, attacker, blocker)) return `${aName} has protection from it.`;
  // CR 702.9b / CR 702.17b: flying can be blocked only by flying or reach.
  if (a('flying') && !b('flying') && !b('reach')) return `${aName} has flying.`;
  // CR 702.36b: fear — only artifact and/or black creatures.
  if (a('fear') && !hasType(g, blocker, 'Artifact') && !colors(g, blocker).includes('B')) return `${aName} has fear.`;
  // CR 702.13b: intimidate — only artifact creatures and/or creatures sharing a color.
  if (a('intimidate') && !hasType(g, blocker, 'Artifact') && !colors(g, blocker).some((c) => colors(g, attacker).includes(c))) {
    return `${aName} has intimidate.`;
  }
  // CR 702.28b: shadow blocks and is blocked only by shadow.
  if (a('shadow') !== b('shadow')) return a('shadow') ? `${aName} has shadow.` : `${nameOf(g, blocker)} has shadow.`;
  // CR 702.31b: horsemanship can be blocked only by horsemanship.
  if (a('horsemanship') && !b('horsemanship')) return `${aName} has horsemanship.`;
  // CR 702.118b: skulk can't be blocked by creatures with greater power.
  if (a('skulk') && power(g, blocker) > power(g, attacker)) return `${aName} has skulk.`;
  // CR 702.14c: landwalk — unblockable while the defending player controls such a land.
  for (const kw of chars(g, attacker).keywords) {
    if (kw.id !== 'landwalk' || !kw.text) continue;
    const words = kw.text.split(' ');
    const defenderLands = g.zones.battlefield
      .map((id) => g.objects[id]!)
      .filter((o) => o.controller === blocker.controller && hasType(g, o, 'Land'));
    const matches = defenderLands.some((land) => {
      const face = faceOf(g, land);
      const traits = [...face.types, ...face.subtypes, ...face.supertypes].map((t) => t.toLowerCase());
      return words.every((w) => {
        if (w === 'land') return true;
        if (w.startsWith('non')) return !traits.includes(w.slice(3));
        return traits.includes(w);
      });
    });
    if (matches) return `${aName} has ${kw.text}walk.`;
  }
  return null;
}

/** Called as the declare blockers step begins: queue every attacked player who could block. */
export function startBlockers(g: GameState): void {
  const attacked = new Set(
    attackingCreatures(g)
      .map((o) => defenderOf(g, g.combat!.attackers[o.id]!.target))
      .filter((p): p is PlayerId => p !== null),
  );
  // CR 802.4: each defending player, in APNAP order, declares blockers.
  g.combat!.toDeclareBlockers = defendingPlayers(g).filter((p) => attacked.has(p));
  promptNextBlocker(g);
}

export function promptNextBlocker(g: GameState): void {
  const c = g.combat!;
  while (c.toDeclareBlockers.length) {
    const player = c.toDeclareBlockers[0]!;
    const blockers = g.zones.battlefield.filter((id) => canBlockAtAll(g, g.objects[id]!, player));
    const attackers = attackingCreatures(g)
      .filter((o) => defenderOf(g, c.attackers[o.id]!.target) === player)
      .map((o) => o.id);
    if (blockers.length && attackers.length) {
      g.pending = { kind: 'declare_blockers', player, blockers, attackers };
      return;
    }
    c.toDeclareBlockers.shift();
  }
  g.pending = null;
}

export function declareBlockers(
  g: GameState,
  player: PlayerId,
  blocks: { blocker: ObjectId; attacker: ObjectId }[],
  events: GameEvent[],
): void {
  const c = g.combat!;
  const used = new Set<ObjectId>();
  const perAttacker = new Map<ObjectId, ObjectId[]>();
  for (const { blocker, attacker } of blocks) {
    const b = g.objects[blocker];
    const a = g.objects[attacker];
    if (!b || !canBlockAtAll(g, b, player)) throw new RulesError(`${b ? nameOf(g, b) : blocker} can’t block.`);
    // CR 509.1a: each blocker blocks one attacking creature.
    if (used.has(blocker)) throw new RulesError(`${nameOf(g, b)} can only block one creature.`);
    used.add(blocker);
    const state = c.attackers[attacker];
    // CR 802.4a: only creatures attacking you or your planeswalkers.
    if (!a || !state || !stillThere(g, attacker, state.zcc) || defenderOf(g, state.target) !== player) {
      throw new RulesError(`${nameOf(g, b)} can only block a creature attacking you or your planeswalkers.`);
    }
    const problem = evasionProblem(g, b, a);
    if (problem) throw new RulesError(`${nameOf(g, b)} can’t block ${nameOf(g, a)}: ${problem}`);
    perAttacker.set(attacker, [...(perAttacker.get(attacker) ?? []), blocker]);
  }
  for (const [attacker, list] of perAttacker) {
    // CR 702.111b: menace — can't be blocked except by two or more creatures.
    if (list.length === 1 && hasKeyword(g, g.objects[attacker]!, 'menace')) {
      throw new RulesError(`${nameOf(g, g.objects[attacker]!)} has menace and needs two or more blockers.`);
    }
  }

  for (const { blocker, attacker } of blocks) {
    // CR 509.1g: it becomes a blocking creature.
    c.blockers[blocker] = { zcc: g.objects[blocker]!.zcc, blocking: attacker };
    const state = c.attackers[attacker]!;
    state.blockers.push({ id: blocker, zcc: g.objects[blocker]!.zcc });
    // CR 509.1h: an attacker with blockers becomes blocked.
    state.blocked = true;
  }
  events.push({ type: 'blocks_declared', player, blocks });
  c.toDeclareBlockers.shift();
}

// ---------------------------------------------------------------------------
// Combat damage (CR 510)
// ---------------------------------------------------------------------------

const hasFirstStrike = (g: GameState, o: GameObject) => hasKeyword(g, o, 'first_strike') || hasKeyword(g, o, 'double_strike');

/**
 * Decides which creatures deal damage in this damage step.
 * CR 510.4: if any attacker or blocker has first strike or double strike, only those deal damage
 * in a first step; a second step follows for the rest, plus creatures with double strike.
 */
function dealersThisStep(g: GameState): GameObject[] {
  const c = g.combat!;
  const all = [...attackingCreatures(g), ...blockingCreatures(g)];
  if (c.firstStrikers === null) {
    const first = all.filter((o) => hasFirstStrike(g, o));
    if (first.length) {
      c.firstStrikers = first.map((o) => o.id);
      c.damageStep = 'first';
      return first;
    }
    c.firstStrikers = [];
  }
  c.damageStep = 'regular';
  return all.filter((o) => !c.firstStrikers!.includes(o.id) || hasKeyword(g, o, 'double_strike'));
}

/** Damage that counts as lethal for a blocker, considering damage already marked (CR 702.19b, CR 702.2c). */
function lethalFor(g: GameState, blocker: GameObject, source: GameObject): number {
  if (hasKeyword(g, source, 'deathtouch')) return 1;
  return Math.max(0, toughness(g, blocker) - blocker.damage);
}

function targetRecipient(g: GameState, target: AttackTarget): DamageRecipient | null {
  if (target.kind === 'player') return livePlayers(g).includes(target.player) ? { kind: 'player', player: target.player } : null;
  const pw = g.objects[target.object];
  return pw && pw.zone === 'battlefield' && hasType(g, pw, 'Planeswalker') ? { kind: 'permanent', object: pw.id } : null;
}

interface PlannedDamage {
  source: ObjectId;
  to: DamageRecipient;
  amount: number;
}

/**
 * Called as a combat damage step begins. Works out every creature's damage; if an attacker's
 * controller has a real choice (several blockers, or trample), asks them first.
 */
export function startCombatDamage(g: GameState, events: GameEvent[]): void {
  const dealers = dealersThisStep(g);
  const c = g.combat!;
  const choices: DamageChoice[] = [];

  for (const o of dealers) {
    const a = c.attackers[o.id];
    if (!a) continue;
    const amount = power(g, o);
    // CR 510.1a: a creature with 0 or less power assigns no combat damage.
    if (amount <= 0) continue;
    const blockers = a.blockers.map((b) => stillThere(g, b.id, b.zcc)).filter((b): b is GameObject => b !== null);
    const trample = hasKeyword(g, o, 'trample');
    const target = targetRecipient(g, a.target);
    if (a.blocked && (blockers.length > 1 || (trample && blockers.length > 0))) {
      choices.push({
        attacker: o.id,
        power: amount,
        blockers: blockers.map((b) => b.id),
        trampleTarget: trample ? target : null,
        suggested: suggestAssignment(g, o, blockers, trample ? target : null, amount),
      });
    }
  }

  if (choices.length) {
    // CR 510.1 / CR 802.5: the active player announces attackers' damage first.
    g.pending = { kind: 'assign_combat_damage', player: g.active, choices };
    return;
  }
  dealCombatDamage(g, planDamage(g, dealers, {}), events);
}

/** Lethal damage to each blocker in turn, the rest to the last blocker — or past them with trample. */
function suggestAssignment(
  g: GameState,
  attacker: GameObject,
  blockers: GameObject[],
  trampleTarget: DamageRecipient | null,
  amount: number,
): DamageAssignment[] {
  const out: DamageAssignment[] = [];
  let left = amount;
  blockers.forEach((b, i) => {
    const give = trampleTarget || i < blockers.length - 1 ? Math.min(left, lethalFor(g, b, attacker)) : left;
    if (give > 0) out.push({ to: { kind: 'permanent', object: b.id }, amount: give });
    left -= give;
  });
  if (left > 0) {
    if (trampleTarget) out.push({ to: trampleTarget, amount: left });
    else if (out.length) out[out.length - 1]!.amount += left;
  }
  return out;
}

const sameRecipient = (a: DamageRecipient, b: DamageRecipient) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.object === (b as typeof a).object);

/** Checks the attacking player's choices (CR 510.1e) and then deals damage. */
export function assignCombatDamage(g: GameState, assignments: Record<ObjectId, DamageAssignment[]>, events: GameEvent[]): void {
  const pending = g.pending;
  if (pending?.kind !== 'assign_combat_damage') throw new RulesError('No combat damage to assign.');
  for (const choice of pending.choices) {
    const given = assignments[choice.attacker];
    const attacker = g.objects[choice.attacker]!;
    const name = nameOf(g, attacker);
    if (!given) throw new RulesError(`Assign ${name}’s damage.`);
    const total = given.reduce((n, d) => n + d.amount, 0);
    // CR 510.1a: a creature assigns combat damage equal to its power.
    if (total !== choice.power || given.some((d) => !Number.isInteger(d.amount) || d.amount < 0)) {
      throw new RulesError(`${name} must assign exactly ${choice.power} damage.`);
    }
    const toBlocker = (id: ObjectId) =>
      given.filter((d) => d.to.kind === 'permanent' && d.to.object === id).reduce((n, d) => n + d.amount, 0);
    const pastBlockers = given.filter((d) => !(d.to.kind === 'permanent' && choice.blockers.includes(d.to.object)));
    const target = choice.trampleTarget;
    // CR 510.1c: a blocked creature assigns its damage among its blockers (CR 702.19b: plus, with trample, what it attacks).
    if (pastBlockers.some((d) => d.amount > 0 && !(target && sameRecipient(d.to, target)))) {
      throw new RulesError(`${name} can only assign damage to its blockers${target ? ' or what it’s attacking' : ''}.`);
    }
    if (pastBlockers.some((d) => d.amount > 0)) {
      // CR 702.19b: lethal damage to every blocker before any is assigned past them.
      for (const id of choice.blockers) {
        const b = g.objects[id]!;
        if (toBlocker(id) < lethalFor(g, b, attacker)) {
          throw new RulesError(`${name} must assign lethal damage to ${nameOf(g, b)} before trampling over.`);
        }
      }
    }
  }
  g.pending = null;
  const dealers = dealersForCurrentStep(g);
  dealCombatDamage(g, planDamage(g, dealers, assignments), events);
}

function dealersForCurrentStep(g: GameState): GameObject[] {
  const c = g.combat!;
  const all = [...attackingCreatures(g), ...blockingCreatures(g)];
  if (c.damageStep === 'first') return all.filter((o) => c.firstStrikers!.includes(o.id));
  return all.filter((o) => !c.firstStrikers!.includes(o.id) || hasKeyword(g, o, 'double_strike'));
}

function planDamage(g: GameState, dealers: GameObject[], chosen: Record<ObjectId, DamageAssignment[]>): PlannedDamage[] {
  const c = g.combat!;
  const plan: PlannedDamage[] = [];
  for (const o of dealers) {
    const amount = power(g, o);
    if (amount <= 0) continue;
    const a = c.attackers[o.id];
    if (a) {
      const picked = chosen[o.id];
      if (picked) {
        for (const d of picked) if (d.amount > 0) plan.push({ source: o.id, to: d.to, amount: d.amount });
        continue;
      }
      const blockers = a.blockers.map((b) => stillThere(g, b.id, b.zcc)).filter((b): b is GameObject => b !== null);
      const target = targetRecipient(g, a.target);
      if (!a.blocked) {
        // CR 510.1b: an unblocked creature damages what it's attacking.
        if (target) plan.push({ source: o.id, to: target, amount });
      } else if (blockers.length === 1) {
        // CR 510.1c: one blocker takes all of it.
        plan.push({ source: o.id, to: { kind: 'permanent', object: blockers[0]!.id }, amount });
      } else if (blockers.length === 0 && hasKeyword(g, o, 'trample') && target) {
        // CR 702.19d: a blocked trampler with no blockers left assigns its damage to what it's attacking.
        plan.push({ source: o.id, to: target, amount });
      }
      // CR 510.1c: blocked with no blockers left (and no trample) — no damage.
      continue;
    }
    const b = c.blockers[o.id];
    if (b) {
      // CR 510.1d: a blocker damages the creature it's blocking, if that's still in combat.
      const state = c.attackers[b.blocking];
      if (state && stillThere(g, b.blocking, state.zcc)) plan.push({ source: o.id, to: { kind: 'permanent', object: b.blocking }, amount });
    }
  }
  return plan;
}

/** CR 510.2: all assigned combat damage is dealt at once. */
function dealCombatDamage(g: GameState, plan: PlannedDamage[], events: GameEvent[]): void {
  const lifeGain = new Map<PlayerId, number>();
  for (const d of plan) {
    const source = g.objects[d.source]!;
    const dealt = dealDamage(g, source, d.to, d.amount, true, events);
    // CR 702.15b / CR 120.3f: lifelink — the source's controller gains the damage dealt.
    if (dealt > 0 && hasKeyword(g, source, 'lifelink')) lifeGain.set(source.controller, (lifeGain.get(source.controller) ?? 0) + dealt);
  }
  for (const [player, amount] of lifeGain) {
    const ps = g.players[player]!;
    ps.life += amount;
    events.push({ type: 'life', player, delta: amount, life: ps.life });
  }
}

/** CR 120.3: what damage does, depending on the recipient and the source's abilities. Returns the damage dealt. */
export function dealDamage(
  g: GameState,
  source: GameObject,
  to: DamageRecipient,
  amount: number,
  combat: boolean,
  events: GameEvent[],
): number {
  if (amount <= 0) return 0;
  const infect = hasKeyword(g, source, 'infect');
  if (to.kind === 'player') {
    const ps = g.players[to.player];
    if (!ps || ps.lost) return 0;
    events.push({ type: 'damage', source: source.id, to, amount, combat });
    if (infect) {
      // CR 120.3b: damage from a source with infect gives poison counters instead.
      ps.poison += amount;
    } else {
      // CR 120.3a: damage to a player makes them lose that much life.
      ps.life -= amount;
      events.push({ type: 'life', player: to.player, delta: -amount, life: ps.life });
    }
    if (combat) {
      // CR 120.3g / CR 702.164c: toxic adds poison counters on combat damage to a player.
      const toxic = chars(g, source).keywords.filter((k) => k.id === 'toxic').reduce((n, k) => n + (k.n ?? 0), 0);
      if (toxic > 0) ps.poison += toxic;
      // CR 903.10a: track combat damage dealt to each player by each commander.
      if (source.commander) {
        const byCommander = (g.commanderDamage[to.player] ??= {});
        byCommander[source.id] = (byCommander[source.id] ?? 0) + amount;
      }
    }
    return amount;
  }
  const o = g.objects[to.object];
  if (!o || o.zone !== 'battlefield') return 0;
  // CR 702.16e: damage from a source with the protected-against quality is prevented.
  if (hasProtectionFrom(g, o, source)) return 0;
  events.push({ type: 'damage', source: source.id, to, amount, combat });
  if (hasType(g, o, 'Planeswalker') && !hasType(g, o, 'Creature')) {
    // CR 120.3c: damage to a planeswalker removes that many loyalty counters.
    o.counters.loyalty = Math.max(0, (o.counters.loyalty ?? 0) - amount);
    return amount;
  }
  if (hasType(g, o, 'Battle') && !hasType(g, o, 'Creature')) {
    // CR 120.3h: damage to a battle removes that many defense counters.
    o.counters.defense = Math.max(0, (o.counters.defense ?? 0) - amount);
    return amount;
  }
  if (infect || hasKeyword(g, source, 'wither')) {
    // CR 120.3d: wither or infect puts -1/-1 counters instead of marking damage.
    o.counters['-1/-1'] = (o.counters['-1/-1'] ?? 0) + amount;
  } else {
    // CR 120.3e: otherwise damage is marked on the creature.
    o.damage += amount;
  }
  // CR 702.2b: any damage from a deathtouch source makes the creature subject to destruction.
  if (hasKeyword(g, source, 'deathtouch')) o.deathtouched = true;
  return amount;
}

/** True if another combat damage step follows this one (CR 510.4). */
export function needsSecondDamageStep(g: GameState): boolean {
  return g.combat?.damageStep === 'first';
}
