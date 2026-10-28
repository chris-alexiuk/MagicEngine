import { isRingBearer } from './ring.js';
import type { AttackTaxNode, ObjectFilter, StaticAbility, StaticPreventionNode } from '@mtg/schema';
import { abilitiesOf, canUseTapAbilities, chars, hasKeyword, hasProtectionFrom, hasRule, hasType, matchesFilter, objectAbilities, power, staticConditionHolds, toughness } from './characteristics.js';
import { payDuringResolution } from './payment.js';
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
import { playerRule } from './player-rules.js';
import { lifeLoss, replaceQuantity } from './quantities.js';
import { amountOf } from './resolve.js';
import { removeShield } from './permanents.js';
import { abilitySources, faceOf, livePlayers, nameOf, nextPlayer, setTapped } from './zones.js';

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
    // CR 702.3b: a creature with defender can't attack (unless an effect says it can anyway).
    (!hasKeyword(g, o, 'defender') || hasRule(g, o, 'can_attack_with_defender')) &&
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
  const exertable = attackers.filter((id) => canExert(g, g.objects[id]!));
  // CR 702.154a: enlist — tap a non-attacking creature that could attack (haste or here since the turn began).
  const enlisters = attackers.filter((id) => chars(g, g.objects[id]!).keywords.some((k) => k.id === 'enlist'));
  const enlistable = enlisters.length ? enlistCandidates(g) : [];
  g.pending = {
    kind: 'declare_attackers',
    player: g.active,
    attackers,
    targets: attackTargets(g),
    ...(exertable.length ? { exertable } : {}),
    ...(enlisters.length && enlistable.length ? { enlisters, enlistable } : {}),
  };
  return true;
}

/** CR 702.154a: untapped creatures the active player controls that could be tapped to enlist. */
function enlistCandidates(g: GameState): ObjectId[] {
  return g.zones.battlefield.filter((id) => {
    const o = g.objects[id]!;
    return o.controller === g.active && !o.tapped && hasType(g, o, 'Creature') && canUseTapAbilities(g, o);
  });
}

/** CR 701.43d: "You may exert this creature as it attacks" (with or without a linked "When you do" trigger). */
export function canExert(g: GameState, o: GameObject): boolean {
  return abilitiesOf(g, o).some(
    (a) =>
      // Combat Celebrant: "If this creature hasn't been exerted this turn, …"
      ((a.kind === 'static' && a.effect.type === 'exert_option' && !(a.effect.notExertedThisTurn && o.exertedTurn === g.turn)) ||
        (a.kind === 'triggered' && a.trigger.type === 'exerted' && Boolean(a.trigger.option) && !(a.trigger.notExertedThisTurn && o.exertedTurn === g.turn))),
  );
}

/** CR 508.1c: restrictions on what a creature may attack ("can't attack unless defending player controls an Island"). */
/** CR 510.1a: the combat damage a creature assigns — its power, or its toughness (Doran, the Siege Tower). */
function combatDamageOf(g: GameState, o: GameObject): number {
  return hasRule(g, o, 'damage_by_toughness') ? toughness(g, o) : power(g, o);
}

/** CR 701.15: the players who goaded it — by a goad effect, or a static "is goaded" (Shiny Impetus: its controller). */
export function goaders(g: GameState, o: GameObject): PlayerId[] {
  const out = [...(o.goadedBy ?? [])];
  for (const r of chars(g, o).combat) {
    const by = r.goaded && r.from ? g.objects[r.from]?.controller : undefined;
    if (by && !out.includes(by)) out.push(by);
  }
  return out;
}

/** CR 508.1d / 701.15b: it attacks each combat if able (or is goaded). */
export function mustAttack(g: GameState, o: GameObject): boolean {
  return hasRule(g, o, 'attacks_each_combat') || goaders(g, o).length > 0 || o.attacksPlayer?.turn === g.turn;
}

export function attackRestriction(g: GameState, o: GameObject, target: AttackTarget): string | null {
  // CR 701.15b: a goaded creature attacks a player other than one who goaded it, if able.
  const goadedBy = goaders(g, o);
  if (goadedBy.length) {
    const defender = defenderOf(g, target);
    if (defender && goadedBy.includes(defender) && attackTargets(g).some((t) => !goadedBy.includes(defenderOf(g, t) ?? '') && !otherRestriction(g, o, t))) {
      return `${nameOf(g, o)} is goaded: it attacks a player other than the one who goaded it, if able.`;
    }
  }
  // CR 702.141a (encore): "attacks that opponent this turn if able".
  const must = o.attacksPlayer?.turn === g.turn ? o.attacksPlayer.player : undefined;
  if (must && defenderOf(g, target) !== must && attackTargets(g).some((t) => defenderOf(g, t) === must && !otherRestriction(g, o, t))) {
    return `${nameOf(g, o)} attacks ${g.players[must]?.name ?? must} this turn if able.`;
  }
  return otherRestriction(g, o, target);
}

function otherRestriction(g: GameState, o: GameObject, target: AttackTarget): string | null {
  // Port Razer: "can't attack a player it has already attacked this turn".
  if (target.kind === 'player' && hasRule(g, o, 'cant_attack_same_player')) {
    const rec = g.turnLog.attackedPlayers?.[o.id];
    if (rec && rec.zcc === o.zcc && rec.players.includes(target.player)) return `${nameOf(g, o)} can’t attack a player it has already attacked this turn.`;
  }
  // Sandwurm Convergence: "Creatures with flying can't attack you or planeswalkers you control." (CR 508.1c)
  for (const id of abilitySources(g)) {
    const src = g.objects[id]!;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'attack_tax') continue;
      const e = (a as StaticAbility).effect as AttackTaxNode;
      if (!e.banned || !staticConditionHolds(g, e, src)) continue;
      const at = target.kind === 'player' ? target.player === src.controller : Boolean(e.planeswalkers) && g.objects[target.object]?.controller === src.controller;
      if (at && (!e.filter || matchesFilter(g, o, e.filter, { controller: src.controller, source: src }))) return `${nameOf(g, o)} can’t attack ${g.players[src.controller]?.name ?? src.controller}${e.planeswalkers ? ' or their planeswalkers' : ''}.`;
    }
  }
  for (const r of chars(g, o).combat) {
    if (!r.attackOnlyIfDefenderControls) continue;
    const defender = defenderOf(g, target);
    const f = r.attackOnlyIfDefenderControls;
    const ok = defender && g.zones.battlefield.some((id) => g.objects[id]!.controller === defender && matchesFilter(g, g.objects[id]!, f, { controller: defender, source: o }));
    if (!ok) return `${nameOf(g, o)} can’t attack unless that player controls a ${[...(f.subtypes ?? []), ...(f.types ?? [])].join(' or ') || 'matching permanent'}.`;
  }
  return null;
}

const sameTarget = (a: AttackTarget, b: AttackTarget) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.object === (b as typeof a).object);

/**
 * CR 508.1g: the total cost to attack with these creatures — "Creatures can't attack you unless their controller pays
 * {2} for each creature they control that's attacking you". The mana symbols, concatenated ("" if none).
 */
export function attackTax(g: GameState, attacks: readonly { attacker: ObjectId; target: AttackTarget }[]): string {
  let out = '';
  for (const id of abilitySources(g)) {
    const src = g.objects[id]!;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'attack_tax') continue;
      const e = (a as StaticAbility).effect as AttackTaxNode;
      if (e.banned || !staticConditionHolds(g, e, src)) continue;
      // Sphere of Safety: {X} each, X counted now.
      const n = e.x ? amountOf({ g, controller: src.controller, source: src, events: [], targets: [], x: 0, memo: {} }, e.x) : 0;
      if (e.x && n <= 0) continue;
      const cost = e.x ? `{${n}}` : e.cost;
      for (const { attacker, target } of attacks) {
        const at = target.kind === 'player' ? target.player === src.controller : Boolean(e.planeswalkers) && g.objects[target.object]?.controller === src.controller;
        const o = g.objects[attacker];
        if (!at || !o || (e.filter && !matchesFilter(g, o, e.filter, { controller: src.controller, source: src }))) continue;
        out += cost;
      }
    }
  }
  return out;
}

/**
 * Silent Arbiter: "No more than one creature can attack each combat." / "… can block each combat."; Crawlspace: "No more
 * than two creatures can attack you each combat." (CR 506.4 restrictions on how many creatures attack or block)
 */
export function combatLimits(g: GameState): { attack: number; block: number; attackPlayer: Partial<Record<PlayerId, number>> } {
  const out = { attack: Infinity, block: Infinity, attackPlayer: {} as Partial<Record<PlayerId, number>> };
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    for (const a of objectAbilities(g, o)) {
      if (a.kind !== 'static' || a.effect.type !== 'combat_limit') continue;
      const n = Number(a.effect.amount ?? 1);
      if (a.effect.what === 'block') out.block = Math.min(out.block, n);
      else if (a.effect.you) out.attackPlayer[o.controller] = Math.min(out.attackPlayer[o.controller] ?? Infinity, n);
      else out.attack = Math.min(out.attack, n);
    }
  }
  return out;
}

export function declareAttackers(
  g: GameState,
  attacks: { attacker: ObjectId; target: AttackTarget }[],
  events: GameEvent[],
  exert: ObjectId[] = [],
  enlist: { attacker: ObjectId; tap: ObjectId }[] = [],
): void {
  // CR 702.154a: each enlisting attacker taps one creature that isn't attacking (an optional cost to attack).
  for (const { attacker, tap } of enlist) {
    const a = g.objects[attacker];
    if (!a || !attacks.some((x) => x.attacker === attacker) || !chars(g, a).keywords.some((k) => k.id === 'enlist')) throw new RulesError('Only an attacking creature with enlist can enlist.');
    if (attacks.some((x) => x.attacker === tap) || !enlistCandidates(g).includes(tap)) throw new RulesError('Enlist taps an untapped creature that isn’t attacking.');
  }
  if (new Set(enlist.map((x) => x.tap)).size !== enlist.length || new Set(enlist.map((x) => x.attacker)).size !== enlist.length) throw new RulesError('Each creature enlists once.');
  // CR 701.43d / 508.1g: exerting is an optional cost to attack, chosen with the attackers.
  for (const id of exert) {
    const o = g.objects[id];
    if (!o || !attacks.some((a) => a.attacker === id)) throw new RulesError('Only an attacking creature can be exerted as it attacks.');
    if (!canExert(g, o)) throw new RulesError(`${nameOf(g, o)} can’t be exerted.`);
  }
  if (new Set(exert).size !== exert.length) throw new RulesError('Each creature can be exerted once as it attacks.');
  const legalTargets = attackTargets(g);
  const seen = new Set<ObjectId>();
  for (const { attacker, target } of attacks) {
    const o = g.objects[attacker];
    if (!o || !canAttack(g, o)) throw new RulesError(`${o ? nameOf(g, o) : attacker} can’t attack.`);
    if (seen.has(attacker)) throw new RulesError(`${nameOf(g, o)} is declared twice.`);
    seen.add(attacker);
    // CR 508.1b / CR 802.3: each attacker attacks a defending player or a planeswalker they control.
    if (!legalTargets.some((t) => sameTarget(t, target))) throw new RulesError(`${nameOf(g, o)} can’t attack that.`);
    const problem = attackRestriction(g, o, target);
    if (problem) throw new RulesError(problem);
  }

  // CR 506.5: "can't attack alone" — not as the only creature declared as an attacker.
  if (attacks.length === 1 && hasRule(g, g.objects[attacks[0]!.attacker]!, 'cant_attack_alone')) {
    throw new RulesError(`${nameOf(g, g.objects[attacks[0]!.attacker]!)} can’t attack alone.`);
  }
  // Silent Arbiter, Crawlspace: how many can attack (CR 506.4).
  const limits = combatLimits(g);
  if (attacks.length > limits.attack) throw new RulesError(`No more than ${limits.attack === 1 ? 'one creature' : `${limits.attack} creatures`} can attack each combat.`);
  const atPlayer = (p: PlayerId) => attacks.filter((a) => a.target.kind === 'player' && a.target.player === p).length;
  for (const [p, n] of Object.entries(limits.attackPlayer)) {
    if (atPlayer(p) > n!) throw new RulesError(`No more than ${n === 1 ? 'one creature' : `${n} creatures`} can attack ${g.players[p]?.name ?? p} each combat.`);
  }
  const full = attacks.length >= limits.attack;
  const open = (t: AttackTarget) => t.kind !== 'player' || atPlayer(t.player) < (limits.attackPlayer[t.player] ?? Infinity);
  // CR 508.1d: a creature that "attacks each combat if able" must attack if it can.
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    // CR 508.1d: a cost to attack is never required, so a creature that would have to pay one isn't required to attack.
    if (!seen.has(id) && canAttack(g, o) && mustAttack(g, o) && legalTargets.some((t) => open(t) && !attackRestriction(g, o, t) && !attackTax(g, [{ attacker: id, target: t }]))) {
      // With a limit reached, the requirement is obeyed as far as possible: no creature without one in its place (CR 508.1d).
      if (full && attacks.every((a) => mustAttack(g, g.objects[a.attacker]!))) continue;
      throw new RulesError(`${nameOf(g, o)} ${goaders(g, o).length ? 'is goaded and must attack' : 'attacks each combat'} if able.`);
    }
  }

  for (const { attacker, target } of attacks) {
    const o = g.objects[attacker]!;
    // CR 508.1f: attacking taps the creature; CR 702.20b: unless it has vigilance.
    if (!hasKeyword(g, o, 'vigilance')) setTapped(g, attacker, true, events);
    // CR 508.1k: it becomes an attacking creature.
    g.combat!.attackers[attacker] = { zcc: o.zcc, target, blocked: false, blockers: [] };
  }
  // CR 508.1h: the costs to attack are paid (mana abilities may be activated, CR 508.1i).
  const tax = attackTax(g, attacks);
  if (tax) {
    try {
      payDuringResolution(g, g.active, tax, events);
    } catch {
      throw new RulesError(`Attacking with those creatures costs ${tax}, which can’t be paid.`);
    }
  }
  g.combat!.attackersDeclared = true;
  // CR 702.154a: "When you do, this creature gets +X/+0 until end of turn, where X is the tapped creature's power."
  for (const { attacker, tap } of enlist) {
    const x = power(g, g.objects[tap]!);
    setTapped(g, tap, true, events);
    const a = g.objects[attacker]!;
    g.triggers.push({
      id: `t${g.nextId++}`,
      controller: g.active,
      source: { id: a.id, zcc: a.zcc },
      sourceName: nameOf(g, a),
      ability: { kind: 'triggered', text: 'Enlist', trigger: { type: 'enlisted' }, effects: [{ type: 'modify', what: { ref: 'self' }, power: x, toughness: 0, until: 'eot' }] },
      info: {},
    });
  }
  // CR 701.43a: an exerted creature won't untap during its controller's next untap step.
  for (const id of exert) {
    g.objects[id]!.exerted = true;
    g.objects[id]!.exertedTurn = g.turn;
    events.push({ type: 'exerted', object: id, player: g.active });
  }
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
  // "Target creature can't block ~ this turn."
  if (blocker.cantBlockThis?.some((x) => x.turn === g.turn && x.attacker.id === attacker.id && x.attacker.zcc === attacker.zcc)) return `${nameOf(g, blocker)} can’t block ${aName} this turn.`;
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
  // CR 701.54c: "Your Ring-bearer … can't be blocked by creatures with greater power."
  if (isRingBearer(attacker) && power(g, blocker) > power(g, attacker)) return `${aName} is a Ring-bearer.`;
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
  // CR 509.1b: restrictions from continuous effects — on the attacker, then on the blocker.
  for (const r of chars(g, attacker).combat) {
    // "can't be blocked by creatures with power less than ~'s power": ~ is the ability's source (Champion of Lambholt).
    const ctx = { controller: attacker.controller, source: (r.from && g.objects[r.from]) || attacker };
    if (r.cantBeBlockedBy && matchesFilter(g, blocker, r.cantBeBlockedBy, ctx)) return `${aName} can’t be blocked by ${nameOf(g, blocker)}.`;
    if (r.blockableOnlyBy && !matchesFilter(g, blocker, r.blockableOnlyBy, ctx)) return `${aName} can’t be blocked by ${nameOf(g, blocker)}.`;
  }
  for (const r of chars(g, blocker).combat) {
    if (r.canBlockOnly && !matchesFilter(g, attacker, r.canBlockOnly, { controller: blocker.controller, source: blocker })) {
      return `${nameOf(g, blocker)} can’t block ${aName}.`;
    }
  }
  return null;
}

/** The fewest and most blockers an attacker can have: menace (CR 702.111b) and "can't be blocked except by three or more". */
function blockerLimits(g: GameState, attacker: GameObject): { min: number; max: number } {
  const c = chars(g, attacker);
  let min = c.keywords.some((k) => k.id === 'menace') ? 2 : 1;
  let max = Infinity;
  for (const r of c.combat) {
    if (r.minBlockers) min = Math.max(min, r.minBlockers);
    if (r.maxBlockers) max = Math.min(max, r.maxBlockers);
  }
  return { min, max };
}

/** Called as the declare blockers step begins: queue every attacked player who could block. */
export function startBlockers(g: GameState, events?: GameEvent[]): void {
  const attacked = new Set(
    attackingCreatures(g)
      .map((o) => defenderOf(g, g.combat!.attackers[o.id]!.target))
      .filter((p): p is PlayerId => p !== null),
  );
  // CR 802.4: each defending player, in APNAP order, declares blockers.
  g.combat!.toDeclareBlockers = defendingPlayers(g).filter((p) => attacked.has(p));
  promptNextBlocker(g, events);
}

export function promptNextBlocker(g: GameState, events?: GameEvent[]): void {
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
  // CR 509.3g: once blocking is over, "attacks and isn't blocked" can trigger.
  if (events && !c.blockersDone) {
    c.blockersDone = true;
    events.push({ type: 'blockers_done' });
  }
}

/**
 * Why a block declaration isn't legal, or null (CR 509.1a–c): restrictions first, then
 * requirements ("must be blocked if able", "All creatures able to block ~ do so"), which must be
 * obeyed as far as possible without breaking a restriction.
 */
/** CR 509.1a: how many attackers this creature can block. */
function blockLimit(g: GameState, o: GameObject): number {
  return 1 + chars(g, o).combat.reduce((n, r) => n + (r.extraBlocks ?? 0), 0);
}

export function blockDeclarationProblem(g: GameState, player: PlayerId, blocks: { blocker: ObjectId; attacker: ObjectId }[]): string | null {
  const c = g.combat!;
  const used = new Map<ObjectId, ObjectId[]>();
  const perAttacker = new Map<ObjectId, ObjectId[]>();
  for (const { blocker, attacker } of blocks) {
    const b = g.objects[blocker];
    const a = g.objects[attacker];
    if (!b || !canBlockAtAll(g, b, player)) return `${b ? nameOf(g, b) : blocker} can’t block.`;
    // CR 509.1a: each blocker blocks one attacking creature — more if an effect says it can.
    const already = used.get(blocker) ?? [];
    if (already.includes(attacker)) return `${nameOf(g, b)} is already blocking that creature.`;
    if (already.length >= blockLimit(g, b)) return already.length === 1 ? `${nameOf(g, b)} can only block one creature.` : `${nameOf(g, b)} can’t block that many creatures.`;
    used.set(blocker, [...already, attacker]);
    const state = c.attackers[attacker];
    // CR 802.4a: only creatures attacking you or your planeswalkers.
    if (!a || !state || !stillThere(g, attacker, state.zcc) || defenderOf(g, state.target) !== player) {
      return `${nameOf(g, b)} can only block a creature attacking you or your planeswalkers.`;
    }
    const problem = evasionProblem(g, b, a);
    if (problem) return `${nameOf(g, b)} can’t block ${nameOf(g, a)}: ${problem}`;
    perAttacker.set(attacker, [...(perAttacker.get(attacker) ?? []), blocker]);
  }
  // CR 506.5: "can't block alone" — not as the only creature declared as a blocker.
  if (used.size === 1 && hasRule(g, g.objects[blocks[0]!.blocker]!, 'cant_block_alone')) return `${nameOf(g, g.objects[blocks[0]!.blocker]!)} can’t block alone.`;
  // Silent Arbiter: "No more than one creature can block each combat." — counting blockers other players declared.
  const blockMax = combatLimits(g).block;
  const others = Object.keys(c.blockers).filter((id) => !used.has(id)).length;
  if (used.size + others > blockMax) return `No more than ${blockMax === 1 ? 'one creature' : `${blockMax} creatures`} can block each combat.`;
  for (const [attacker, list] of perAttacker) {
    const a = g.objects[attacker]!;
    const { min, max } = blockerLimits(g, a);
    // CR 702.111b: menace — can't be blocked except by two or more creatures (and the like).
    if (list.length < min) return min === 2 && hasKeyword(g, a, 'menace') ? `${nameOf(g, a)} has menace and needs two or more blockers.` : `${nameOf(g, a)} needs ${min} or more blockers.`;
    if (list.length > max) return `${nameOf(g, a)} can’t be blocked by more than ${max === 1 ? 'one creature' : `${max} creatures`}.`;
  }

  // CR 509.1c: requirements.
  const attackers = attackingCreatures(g).filter((o) => defenderOf(g, c.attackers[o.id]!.target) === player);
  const potential = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => canBlockAtAll(g, o, player));
  const able = (b: GameObject, a: GameObject) => !evasionProblem(g, b, a);
  const requirement = (a: GameObject, kind: 'one' | 'all') => chars(g, a).combat.some((r) => r.mustBeBlocked === kind);
  // A requirement that can't be met without breaking "needs N blockers" doesn't apply.
  const reachable = (a: GameObject) => potential.filter((b) => able(b, a)).length >= blockerLimits(g, a).min;
  const lures = attackers.filter((a) => requirement(a, 'all') && reachable(a));
  const blocking = new Map(blocks.map((x) => [x.blocker, x.attacker]));
  for (const b of potential) {
    const target = blocking.get(b.id);
    if (target && lures.some((l) => l.id === target)) continue;
    const lure = lures.find((l) => able(b, l) && (perAttacker.get(l.id)?.length ?? 0) < blockerLimits(g, l).max);
    if (lure) return `${nameOf(g, b)} must block ${nameOf(g, lure)} if able.`;
  }
  // "blocks each combat if able", "blocks ~ this turn if able" (requirements on the blocker).
  const room = (a: GameObject) => (perAttacker.get(a.id)?.length ?? 0) < blockerLimits(g, a).max;
  for (const b of potential) {
    const target = blocking.get(b.id);
    if (target && lures.some((l) => l.id === target)) continue;
    const reqs = (b.mustBlock ?? []).filter((m) => m.turn === g.turn);
    for (const m of reqs) {
      if (!m.attacker) continue;
      const a = attackers.find((x) => x.id === m.attacker!.id && x.zcc === m.attacker!.zcc);
      if (a && target !== a.id && able(b, a) && reachable(a) && room(a)) return `${nameOf(g, b)} must block ${nameOf(g, a)} if able.`;
    }
    if ((hasRule(g, b, 'blocks_each_combat') || reqs.some((m) => !m.attacker)) && !target && attackers.some((a) => able(b, a) && reachable(a) && room(a))) {
      return `${nameOf(g, b)} must block if able.`;
    }
  }
  for (const a of attackers.filter((x) => requirement(x, 'one') && reachable(x))) {
    if (perAttacker.has(a.id)) continue;
    // Blocking it would obey this requirement; a creature already blocking a lure is obeying another one.
    const free = potential.find((b) => able(b, a) && !lures.some((l) => l.id === blocking.get(b.id)));
    if (free) return `${nameOf(g, a)} must be blocked if able.`;
  }
  return null;
}

export function declareBlockers(
  g: GameState,
  player: PlayerId,
  blocks: { blocker: ObjectId; attacker: ObjectId }[],
  events: GameEvent[],
): void {
  const c = g.combat!;
  const problem = blockDeclarationProblem(g, player, blocks);
  if (problem) throw new RulesError(problem);
  for (const { blocker, attacker } of blocks) {
    // CR 509.1g: it becomes a blocking creature (of each attacker it blocks).
    const zcc = g.objects[blocker]!.zcc;
    const prior = c.blockers[blocker];
    if (prior && prior.zcc === zcc) (prior.alsoBlocking ??= []).push(attacker);
    else c.blockers[blocker] = { zcc, blocking: attacker };
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
    const amount = combatDamageOf(g, o);
    // CR 510.1a: a creature with 0 or less power assigns no combat damage.
    if (amount <= 0) continue;
    const blockers = a.blockers.map((b) => stillThere(g, b.id, b.zcc)).filter((b): b is GameObject => b !== null);
    const trample = hasKeyword(g, o, 'trample');
    const target = targetRecipient(g, a.target);
    // CR 510.1c: "You may have ~ assign its combat damage as though it weren't blocked."
    const asUnblocked = a.blocked && target && hasRule(g, o, 'assign_as_unblocked') ? target : undefined;
    if (a.blocked && (blockers.length > 1 || (trample && blockers.length > 0) || asUnblocked)) {
      choices.push({
        attacker: o.id,
        power: amount,
        blockers: blockers.map((b) => b.id),
        trampleTarget: trample ? target : null,
        ...(asUnblocked ? { unblockedTarget: asUnblocked } : {}),
        suggested: suggestAssignment(g, o, blockers, trample ? target : null, amount),
      });
    }
  }

  // CR 510.1d: a creature blocking two or more attackers divides its damage among them as its controller chooses.
  const byDefender = new Map<PlayerId, DamageChoice[]>();
  for (const o of dealers) {
    const b = c.blockers[o.id];
    if (!b?.alsoBlocking?.length) continue;
    const amount = combatDamageOf(g, o);
    if (amount <= 0) continue;
    const blocked = blockedAttackers(g, b);
    if (blocked.length < 2) continue;
    const list = byDefender.get(o.controller) ?? [];
    list.push({ attacker: o.id, power: amount, blockers: blocked.map((x) => x.id), trampleTarget: null, suggested: suggestAssignment(g, o, blocked, null, amount) });
    byDefender.set(o.controller, list);
  }
  // CR 510.1 / CR 802.5: the active player announces attackers' damage first, then each defending player in turn order.
  const queue = [
    ...(choices.length ? [{ player: g.active, choices }] : []),
    ...defendingPlayers(g).flatMap((p) => (byDefender.has(p) ? [{ player: p, choices: byDefender.get(p)! }] : [])),
  ];
  if (queue.length) {
    const [first, ...rest] = queue;
    g.pending = { kind: 'assign_combat_damage', player: first!.player, choices: first!.choices };
    c.damageQueue = rest;
    c.assigned = {};
    return;
  }
  dealCombatDamage(g, planDamage(g, dealers, {}), events);
}

/** The attackers a blocker is blocking that are still in combat. */
function blockedAttackers(g: GameState, b: { blocking: ObjectId; alsoBlocking?: ObjectId[] }): GameObject[] {
  const c = g.combat!;
  return [b.blocking, ...(b.alsoBlocking ?? [])].flatMap((id) => {
    const state = c.attackers[id];
    const o = state ? stillThere(g, id, state.zcc) : null;
    return o ? [o] : [];
  });
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
    // CR 510.1c: all of it to what it's attacking, as though it weren't blocked.
    if (choice.unblockedTarget && given.every((d) => d.amount === 0 || sameRecipient(d.to, choice.unblockedTarget!))) continue;
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
  // The next player announces theirs; once everyone has, all of it is dealt at once (CR 510.2).
  const c = g.combat!;
  c.assigned = { ...(c.assigned ?? {}), ...Object.fromEntries(pending.choices.map((x) => [x.attacker, assignments[x.attacker]!])) };
  const next = c.damageQueue?.shift();
  if (next) {
    g.pending = { kind: 'assign_combat_damage', player: next.player, choices: next.choices };
    return;
  }
  g.pending = null;
  const chosen = c.assigned;
  delete c.assigned;
  delete c.damageQueue;
  const dealers = dealersForCurrentStep(g);
  dealCombatDamage(g, planDamage(g, dealers, chosen), events);
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
    const amount = combatDamageOf(g, o);
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
      // CR 510.1d: as its controller divided it among the creatures it's blocking.
      const picked = chosen[o.id];
      if (picked) {
        for (const d of picked) if (d.amount > 0) plan.push({ source: o.id, to: d.to, amount: d.amount });
        continue;
      }
      // CR 510.1d: a blocker damages the creature it's blocking, if that's still in combat.
      const blocked = blockedAttackers(g, b);
      if (blocked.length === 1) plan.push({ source: o.id, to: { kind: 'permanent', object: blocked[0]!.id }, amount });
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
  for (const [player, dealt] of lifeGain) {
    const ps = g.players[player]!;
    if (playerRule(g, player, 'cant_gain_life') || playerRule(g, player, 'life_cant_change')) continue;
    const amount = replaceQuantity(g, 'gain_life', dealt, { player });
    ps.life += amount;
    events.push({ type: 'life', player, delta: amount, life: ps.life });
  }
}

/** CR 120.3: what damage does, depending on the recipient and the source's abilities. Returns the damage dealt. */
/**
 * CR 120.4a / 120.10: how much damage this source would need to deal to a permanent before the rest is excess — lethal
 * damage for a creature (1 from a deathtouch source, CR 702.2c), loyalty for a planeswalker, defense for a battle; with
 * more than one of those types, the least (the excess is the greatest).
 */
export function damageBeforeExcess(g: GameState, source: GameObject, o: GameObject): number {
  const caps: number[] = [];
  if (hasType(g, o, 'Creature')) {
    const left = Math.max(0, toughness(g, o) - o.damage);
    caps.push(hasKeyword(g, source, 'deathtouch') ? Math.min(1, left) : left);
  }
  if (hasType(g, o, 'Planeswalker')) caps.push(o.counters.loyalty ?? 0);
  if (hasType(g, o, 'Battle')) caps.push(o.counters.defense ?? 0);
  return caps.length ? Math.min(...caps) : Infinity;
}

/** CR 615.12: a static ability saying damage (or combat damage) can't be prevented. */
function staticUnpreventable(g: GameState, combat: boolean, source: GameObject): boolean {
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    for (const a of objectAbilities(g, o)) {
      if (a.kind !== 'static' || a.effect.type !== 'unpreventable' || (!combat && a.effect.combat)) continue;
      // Questing Beast: "… dealt by creatures you control …" — only from those sources.
      if (a.effect.from && !matchesFilter(g, source, a.effect.from as ObjectFilter, { controller: o.controller, source: o })) continue;
      return true;
    }
  }
  return false;
}

export function dealDamage(
  g: GameState,
  source: GameObject,
  to: DamageRecipient,
  amount: number,
  combat: boolean,
  events: GameEvent[],
): number {
  // CR 614.1a: "it deals double that damage instead"; then prevention (CR 615).
  amount = replaceQuantity(g, 'damage', amount, { source, to, combat });
  // CR 615.12: "Damage can't be prevented this turn."; Frenzied Baloth: "Combat damage can't be prevented." (a static).
  const unpreventable = g.unpreventableTurn === g.turn || staticUnpreventable(g, combat, source);
  if (!unpreventable) amount = prevent(g, source, to, amount, combat, events);
  // CR 702.16j: damage to a player with protection from everything is prevented.
  if (!unpreventable && amount > 0 && to.kind === 'player' && playerRule(g, to.player, 'protection_everything')) {
    events.push({ type: 'prevented', source: source.id, amount });
    return 0;
  }
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
      // CR 120.3a: damage to a player makes them lose that much life (CR 119.8: unless their life total can't change).
      if (!playerRule(g, to.player, 'life_cant_change')) {
        // Bloodletter of Aclazotz: the damage is the same; the life lost may be more.
        const lost = lifeLoss(g, to.player, amount);
        ps.life -= lost;
        events.push({ type: 'life', player: to.player, delta: -lost, life: ps.life });
      }
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
  if (!unpreventable && hasProtectionFrom(g, o, source)) return 0;
  // CR 122.1c: a shield counter is removed instead (a replacement, not prevention — it works even when damage can't be prevented).
  if (removeShield(o, events)) return 0;
  events.push({ type: 'damage', source: source.id, to, amount, combat });
  o.damagedTurn = g.turn;
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
    o.damagedTurn = g.turn;
  }
  // CR 702.2b: any damage from a deathtouch source makes the creature subject to destruction.
  if (hasKeyword(g, source, 'deathtouch')) o.deathtouched = true;
  return amount;
}

/** CR 615.1a: a static ability that prevents this damage (Dolmen Gate, Glacial Chasm, Fog Bank). */
/** Static prevention for this damage: all of it, or how many times half of it is prevented (Gisela). */
function staticallyPrevented(g: GameState, source: GameObject, to: DamageRecipient, combat: boolean): { all: boolean; halves: number } {
  let halves = 0;
  // Caduceus, Staff of Hermes: equipped creature has "Prevent all damage that would be dealt to this creature." — a
  // granted ability of the creature itself.
  const recipient = to.kind === 'permanent' ? g.objects[to.object] : undefined;
  if (recipient) {
    for (const k of chars(g, recipient).keywords) {
      if (k.id !== 'ability') continue;
      for (const a of k.abilities ?? []) {
        if (a.kind !== 'static' || a.effect.type !== 'prevent_damage') continue;
        const e = a.effect as StaticPreventionNode;
        if (!e.toSelf || (e.damage === 'combat' && !combat) || (e.damage === 'noncombat' && combat)) continue;
        return { all: true, halves: 0 };
      }
    }
  }
  for (const id of abilitySources(g)) {
    const holder = g.objects[id]!;
    for (const a of objectAbilities(g, holder)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'prevent_damage') continue;
      const e = (a as StaticAbility).effect as StaticPreventionNode;
      if ((e.damage === 'combat' && !combat) || (e.damage === 'noncombat' && combat)) continue;
      if (!staticConditionHolds(g, e, holder)) continue;
      let hit = false;
      if (e.bySelf && source.id === holder.id) hit = true;
      else if (to.kind === 'player') hit = Boolean(e.toYou && to.player === holder.controller);
      else {
        const o = g.objects[to.object];
        hit = Boolean(o && ((e.toSelf && o.id === holder.id) || (e.to && matchesFilter(g, o, e.to, { controller: holder.controller, source: holder }))));
      }
      if (!hit) continue;
      if (e.half) halves++;
      else return { all: true, halves };
    }
  }
  return { all: false, halves };
}

/** CR 615: applies prevention effects to damage about to be dealt; returns what's left. */
function prevent(g: GameState, source: GameObject, to: DamageRecipient, amount: number, combat: boolean, events: GameEvent[]): number {
  const fixed = amount > 0 ? staticallyPrevented(g, source, to, combat) : { all: false, halves: 0 };
  if (fixed.all) {
    events.push({ type: 'prevented', source: source.id, amount });
    return 0;
  }
  // Gisela: "prevent half that damage, rounded up" — what's left is half, rounded down.
  if (fixed.halves) {
    const before = amount;
    for (let i = 0; i < fixed.halves; i++) amount = Math.floor(amount / 2);
    if (amount < before) events.push({ type: 'prevented', source: source.id, amount: before - amount });
  }
  if (amount <= 0 || !g.prevention.length) return amount;
  const left0 = amount;
  for (const p of g.prevention) {
    if (amount <= 0) break;
    if (p.turn !== g.turn || (p.combat && !combat)) continue;
    if (p.to) {
      const hit = p.to.kind === 'player' ? to.kind === 'player' && to.player === p.to.player : p.to.kind === 'object' && to.kind === 'permanent' && to.object === p.to.id && g.objects[p.to.id]?.zcc === p.to.zcc;
      if (!hit) continue;
    }
    if (p.by && !(p.by.kind === 'object' && p.by.id === source.id && p.by.zcc === source.zcc)) continue;
    const fctx = { controller: p.controller ?? source.controller, source: null, anyZone: true };
    if (p.byFilter && !matchesFilter(g, source, p.byFilter, fctx)) continue;
    if (p.toFilter && !(to.kind === 'permanent' && g.objects[to.object] && matchesFilter(g, g.objects[to.object]!, p.toFilter, fctx))) continue;
    if (p.once) {
      amount = 0;
      p.amount = 0;
    } else if (p.amount === 'all') amount = 0;
    else {
      // CR 615.7: a shield prevents that much and is used up.
      const used = Math.min(p.amount, amount);
      p.amount -= used;
      amount -= used;
    }
  }
  g.prevention = g.prevention.filter((p) => (p.amount === 'all' || p.amount > 0) && !(p.once && p.amount === 0));
  if (amount < left0) events.push({ type: 'prevented', source: source.id, amount: left0 - amount });
  return amount;
}

/** True if another combat damage step follows this one (CR 510.4). */
export function needsSecondDamageStep(g: GameState): boolean {
  return g.combat?.damageStep === 'first';
}
