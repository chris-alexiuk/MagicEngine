import type { EffectNode, TargetSpec } from '@mtg/schema';
import { hasHexproofFrom, hasKeyword, hasProtectionFrom, matchesFilter } from './characteristics.js';
import { RulesError, type GameObject, type GameState, type PlayerId, type StackEntry, type Target, type TargetPrompt, type TargetRef } from './types.js';
import { playerRule } from './player-rules.js';
import { livePlayers, nameOf } from './zones.js';

/**
 * Targeting (CR 115). `source` is the object the spell or ability comes from: the
 * spell itself for a spell, or the permanent whose ability it is.
 */

function canTargetObject(g: GameState, controller: PlayerId, spec: TargetSpec, o: GameObject, source: GameObject | null): boolean {
  // CR 115.5: a spell or ability on the stack can't target itself.
  if (source && source.id === o.id && o.zone === 'stack') return false;
  const filter = spec.filter ?? {};
  if (!matchesFilter(g, o, filter, { controller, source })) return false;
  if (o.zone === 'battlefield') {
    // CR 702.18a: shroud — can't be the target of spells or abilities.
    if (hasKeyword(g, o, 'shroud')) return false;
    // CR 702.11b: hexproof — can't be the target of spells or abilities its controller's opponents control.
    if (o.controller !== controller && hasKeyword(g, o, 'hexproof')) return false;
    if (o.controller !== controller && source && hasHexproofFrom(g, o, source)) return false;
    // CR 702.16b: protection — can't be targeted by spells or abilities from a source with that quality.
    if (source && hasProtectionFrom(g, o, source)) return false;
  }
  return true;
}

/**
 * CR 113.1c / 602.2a: an activated or triggered ability on the stack — "target activated ability
 * you control from an artifact source". Its source is the object it came from (CR 113.7), wherever that is now.
 */
/** CR 115.10: "a spell or ability with a single target" — exactly one target, counting each instance of "target". */
function singleTargeted(entry: StackEntry | undefined): boolean {
  return Boolean(entry && entry.targets.reduce((n, list) => n + list.length, 0) === 1);
}

/** "with a single target" (CR 115.10), "that targets you or a creature you control": what the spell or ability targets. */
function stackEntryOk(g: GameState, controller: PlayerId, spec: TargetSpec, entry: StackEntry | undefined): boolean {
  if (spec.singleTarget && !singleTargeted(entry)) return false;
  const want = spec.targeting;
  if (!want) return true;
  if (!entry) return false;
  return entry.targets.some((list) =>
    list.some((t) => {
      if (t.kind === 'player') return Boolean(want.you) && t.player === controller;
      if (t.kind !== 'object' || !want.filter) return false;
      const o = g.objects[t.id];
      return Boolean(o && o.zcc === t.zcc && matchesFilter(g, o, want.filter, { controller }));
    }),
  );
}

function canTargetAbility(g: GameState, controller: PlayerId, spec: TargetSpec, id: string): boolean {
  const entry = g.stack.find((s) => s.kind === 'ability' && s.id === id);
  if (entry?.kind !== 'ability') return false;
  if (!stackEntryOk(g, controller, spec, entry)) return false;
  const kind = entry.trigger ? 'triggered' : 'activated';
  if (spec.abilities && !spec.abilities.includes(kind)) return false;
  if (spec.player === 'you' && entry.controller !== controller) return false;
  if (spec.player === 'opponent' && entry.controller === controller) return false;
  if (spec.source) {
    const src = g.objects[entry.source.id];
    if (!src || !matchesFilter(g, src, spec.source, { controller, anyZone: true })) return false;
  }
  return true;
}

function canTargetPlayer(g: GameState, controller: PlayerId, spec: TargetSpec, player: PlayerId): boolean {
  if (!livePlayers(g).includes(player)) return false;
  if (spec.player === 'opponent' && player === controller) return false;
  if (spec.player === 'you' && player !== controller) return false;
  // CR 702.11c: a player with hexproof can't be the target of spells or abilities their opponents control;
  // CR 702.18: with shroud, of any spell or ability.
  if (playerRule(g, player, 'shroud')) return false;
  // CR 702.16j: a player with protection from everything can't be the target of spells or abilities.
  if (playerRule(g, player, 'protection_everything')) return false;
  if (player !== controller && playerRule(g, player, 'hexproof')) return false;
  return true;
}

export function isLegalTarget(
  g: GameState,
  controller: PlayerId,
  spec: TargetSpec,
  t: TargetRef | Target,
  source: GameObject | null,
): boolean {
  if (t.kind === 'player') return spec.what !== 'object' && spec.what !== 'ability' && canTargetPlayer(g, controller, spec, t.player);
  if (t.kind === 'ability') return spec.what === 'ability' && canTargetAbility(g, controller, spec, t.entry);
  if (spec.what === 'player') return false;
  if (spec.what === 'ability' && !spec.spells) return false;
  const id = 'id' in t ? t.id : t.object;
  const o = g.objects[id];
  if (!o) return false;
  if ((spec.singleTarget || spec.targeting) && !stackEntryOk(g, controller, spec, g.stack.find((s) => s.kind === 'spell' && s.object === id))) return false;
  // CR 608.2b: an object that changed zones since it was targeted is a new object — an illegal target.
  if ('zcc' in t && o.zcc !== t.zcc) return false;
  return canTargetObject(g, controller, spec.what === 'ability' ? { ...spec, filter: { ...spec.spells, zone: 'stack' } } : spec, o, source);
}

/** Every legal choice for one target spec, players first. */
export function targetCandidates(g: GameState, controller: PlayerId, spec: TargetSpec, source: GameObject | null): Target[] {
  const out: Target[] = [];
  if (spec.what === 'ability') {
    for (const s of g.stack) {
      if (s.kind === 'ability' && canTargetAbility(g, controller, spec, s.id)) out.push({ kind: 'ability', entry: s.id });
      if (s.kind === 'spell' && spec.spells && stackEntryOk(g, controller, spec, s)) {
        const o = g.objects[s.object];
        if (o && canTargetObject(g, controller, { ...spec, filter: { ...spec.spells, zone: 'stack' } }, o, source)) out.push({ kind: 'object', object: s.object });
      }
    }
    return out;
  }
  if (spec.what !== 'object') {
    for (const p of livePlayers(g)) if (canTargetPlayer(g, controller, spec, p)) out.push({ kind: 'player', player: p });
  }
  if (spec.what !== 'player') {
    const zone = spec.filter?.zone ?? 'battlefield';
    const ids =
      zone === 'battlefield'
        ? g.zones.battlefield
        : zone === 'stack'
          ? g.stack.flatMap((e) => (e.kind === 'spell' ? [e.object] : []))
          : zone === 'exile' || zone === 'command'
            ? g.zones[zone]
            : g.order.flatMap((p) => g.zones[zone][p] ?? []);
    // "For each opponent, … target creature that player controls": only those players' objects.
    const players = spec.perPlayer ? perPlayerSet(g, controller, spec) : null;
    for (const id of ids) {
      if ((spec.singleTarget || spec.targeting) && !stackEntryOk(g, controller, spec, g.stack.find((s) => s.kind === 'spell' && s.object === id))) continue;
      const o = g.objects[id];
      if (!o || (players && !players.includes(o.zone === 'battlefield' ? o.controller : o.owner))) continue;
      if (canTargetObject(g, controller, spec, o, source)) out.push({ kind: 'object', object: id });
    }
  }
  return out;
}

/** The players a "for each opponent, … target … that player controls" spec has a target for. */
export function perPlayerSet(g: GameState, controller: PlayerId, spec: TargetSpec): PlayerId[] {
  if (!spec.perPlayer) return [];
  return livePlayers(g).filter((p) => spec.perPlayer === 'each' || p !== controller);
}

/** Whose a target of a per-player spec is: a permanent's controller, otherwise the card's owner. */
function whoseTarget(g: GameState, t: Target): PlayerId | undefined {
  if (t.kind !== 'object') return undefined;
  const o = g.objects[t.object];
  return o ? (o.zone === 'battlefield' ? o.controller : o.owner) : undefined;
}

/** How many targets a spec takes at most (CR 601.2c). */
export function targetCount(g: GameState, controller: PlayerId, spec: TargetSpec): number {
  return spec.perPlayer ? perPlayerSet(g, controller, spec).length : (spec.count ?? 1);
}

/**
 * How many targets a spec needs at least: "up to" any minimum; per-player specs one for each player who has a
 * legal one (at least one); otherwise all of them.
 */
export function targetsRequired(g: GameState, controller: PlayerId, spec: TargetSpec, candidates: readonly Target[]): number {
  if (spec.upTo) return spec.min ?? 0;
  if (spec.perPlayer) {
    const players = new Set(candidates.map((t) => whoseTarget(g, t)));
    return Math.max(1, perPlayerSet(g, controller, spec).filter((p) => players.has(p)).length);
  }
  return spec.count ?? 1;
}

export function targetPrompts(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null): TargetPrompt[] {
  return specs.map((spec) => {
    const candidates = targetCandidates(g, controller, spec, source);
    const min = spec.perPlayer ? targetsRequired(g, controller, spec, candidates) : spec.upTo ? spec.min : undefined;
    return {
      text: spec.text,
      count: targetCount(g, controller, spec),
      upTo: Boolean(spec.upTo || spec.perPlayer),
      // "one, two, or three targets": at least this many (CR 601.2c).
      ...(min ? { min } : {}),
      ...(spec.sameOwner ? { sameOwner: true as const } : {}),
      ...(spec.perPlayer ? { perPlayer: true as const } : {}),
      candidates,
    };
  });
}

/** CR 601.2c / CR 115.6: whether enough legal targets exist for every spec. */
export function canChooseTargets(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null): boolean {
  return specs.every((spec) => {
    const candidates = targetCandidates(g, controller, spec, source);
    return candidates.length >= targetsRequired(g, controller, spec, candidates);
  });
}

/**
 * CR 601.2d: how divided damage is split among the chosen targets — the player's division, or an even
 * one by default (any remainder to the first targets). Each target gets at least 1.
 */
/** `count`: the amount when it's counted ("X damage divided …, where X is the number of creatures you control"). */
export function divisionFor(effects: EffectNode[], targets: readonly (readonly unknown[])[], x: number, given?: number[], count?: (amount: unknown) => number): number[] | undefined {
  const node = findDivided(effects);
  if (!node) return undefined;
  const total = node.amount === 'X' ? x : typeof node.amount === 'number' ? node.amount : (count?.(node.amount) ?? 0);
  const index = ((node.to ?? node.what) as { index?: number }).index ?? 0;
  const k = targets[index]?.length ?? 0;
  const what = node.type === 'add_counters' ? 'counters' : 'damage';
  if (k === 0) return [];
  if (k > total) throw new RulesError(`Each target needs at least 1 of the ${total} ${what}.`);
  if (given) {
    if (given.length !== k || given.some((n) => !Number.isInteger(n) || n < 1) || given.reduce((a, b) => a + b, 0) !== total) {
      throw new RulesError(`Divide ${total} ${what} among the ${k} target(s), at least 1 each.`);
    }
    return [...given];
  }
  return Array.from({ length: k }, (_, i) => Math.floor(total / k) + (i < total % k ? 1 : 0));
}

/**
 * CR 601.2d: each target of a division gets at least 1, so a divided total caps how many can be chosen.
 * The index of the divided spec and its total, or null.
 */
export function dividedCap(effects: EffectNode[], x: number, count?: (amount: unknown) => number): { index: number; total: number } | null {
  const node = findDivided(effects);
  if (!node) return null;
  const total = node.amount === 'X' ? x : typeof node.amount === 'number' ? node.amount : (count?.(node.amount) ?? 0);
  return { index: ((node.to ?? node.what) as { index?: number }).index ?? 0, total };
}

function findDivided(effects: EffectNode[]): EffectNode | undefined {
  for (const e of effects) {
    if ((e.type === 'deal_damage' || e.type === 'add_counters') && e.divided) return e;
    for (const k of ['effects', 'then', 'else']) {
      const inner = Array.isArray(e[k]) ? findDivided(e[k] as EffectNode[]) : undefined;
      if (inner) return inner;
    }
  }
  return undefined;
}

/** A default legal choice: the first candidates for each spec (UIs let the player change them). */
export function defaultTargets(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null): Target[][] | null {
  const out: Target[][] = [];
  for (const spec of specs) {
    const candidates = targetCandidates(g, controller, spec, source);
    const n = targetCount(g, controller, spec);
    if (candidates.length < targetsRequired(g, controller, spec, candidates)) return null;
    if (spec.perPlayer) {
      // One for each player who has a legal one.
      const picks: Target[] = [];
      for (const p of perPlayerSet(g, controller, spec)) {
        const t = candidates.find((c) => whoseTarget(g, c) === p);
        if (t) picks.push(t);
      }
      out.push(picks);
      continue;
    }
    // "from a single graveyard": the cards of an owner who has enough of them.
    if (spec.sameOwner) {
      const need = targetsRequired(g, controller, spec, candidates);
      const ownerOf = (t: Target) => (t.kind === 'object' ? g.objects[t.object]?.owner : undefined);
      const owner = [...new Set(candidates.map(ownerOf))].find((p) => p && candidates.filter((t) => ownerOf(t) === p).length >= need);
      if (!owner) return null;
      out.push(candidates.filter((t) => ownerOf(t) === owner).slice(0, n));
      continue;
    }
    out.push(candidates.slice(0, n));
  }
  return out;
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind &&
  (a.kind === 'player' ? a.player === (b as typeof a).player : a.kind === 'ability' ? a.entry === (b as typeof a).entry : a.object === (b as typeof a).object);

/**
 * Checks a player's target choices and turns them into stored references.
 * CR 115.3: the same object or player can't be chosen twice for one instance of "target".
 */
export function chooseTargets(
  g: GameState,
  controller: PlayerId,
  specs: TargetSpec[],
  chosen: Target[][] | undefined,
  source: GameObject | null,
): TargetRef[][] {
  const given = chosen ?? [];
  if (given.length !== specs.length) {
    throw new RulesError(specs.length ? `Choose targets: ${specs.map((s) => s.text).join('; ')}.` : 'This doesn’t take targets.');
  }
  return specs.map((spec, i) => {
    const list = given[i]!;
    const n = targetCount(g, controller, spec);
    if (spec.perPlayer) {
      // CR 601.2c: each target for a different one of those players.
      const need = targetsRequired(g, controller, spec, targetCandidates(g, controller, spec, source));
      if (list.length > n || list.length < need) throw new RulesError(`Choose ${spec.upTo ? 'up to ' : ''}one for each player for “${spec.text}”.`);
      const owners = list.map((t) => whoseTarget(g, t));
      const players = perPlayerSet(g, controller, spec);
      if (new Set(owners).size !== owners.length || owners.some((p) => !p || !players.includes(p))) throw new RulesError(`Each target for “${spec.text}” must belong to a different player.`);
    } else if (list.length > n || (!spec.upTo && list.length < n) || list.length < (spec.min ?? 0)) {
      throw new RulesError(`Choose ${spec.upTo ? `${spec.min ? `${spec.min} to ` : 'up to '}` : ''}${n} for “${spec.text}”.`);
    }
    // "from a single graveyard"
    if (spec.sameOwner && new Set(list.map((t) => (t.kind === 'object' ? g.objects[t.object]?.owner : undefined))).size > 1) {
      throw new RulesError(`The targets for “${spec.text}” must all be in one graveyard.`);
    }
    list.forEach((t, j) => {
      if (list.slice(0, j).some((u) => sameTarget(t, u))) throw new RulesError(`The same target was chosen twice for “${spec.text}”.`);
      if (!isLegalTarget(g, controller, spec, t, source)) {
        const what =
          t.kind === 'player'
            ? (g.players[t.player]?.name ?? t.player)
            : t.kind === 'ability'
              ? 'That ability'
              : g.objects[t.object]
                ? nameOf(g, g.objects[t.object]!)
                : t.object;
        throw new RulesError(`${what} isn’t a legal target for “${spec.text}”.`);
      }
    });
    return list.map((t): TargetRef => (t.kind === 'player' || t.kind === 'ability' ? t : { kind: 'object', id: t.object, zcc: g.objects[t.object]!.zcc }));
  });
}
