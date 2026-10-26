import type { TargetSpec } from '@mtg/schema';
import { hasHexproofFrom, hasKeyword, hasProtectionFrom, matchesFilter } from './characteristics.js';
import { RulesError, type GameObject, type GameState, type PlayerId, type Target, type TargetPrompt, type TargetRef } from './types.js';
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

function canTargetPlayer(g: GameState, controller: PlayerId, spec: TargetSpec, player: PlayerId): boolean {
  if (!livePlayers(g).includes(player)) return false;
  if (spec.player === 'opponent' && player === controller) return false;
  if (spec.player === 'you' && player !== controller) return false;
  return true;
}

export function isLegalTarget(
  g: GameState,
  controller: PlayerId,
  spec: TargetSpec,
  t: TargetRef | Target,
  source: GameObject | null,
): boolean {
  if (t.kind === 'player') return spec.what !== 'object' && canTargetPlayer(g, controller, spec, t.player);
  if (spec.what === 'player') return false;
  const id = 'id' in t ? t.id : t.object;
  const o = g.objects[id];
  if (!o) return false;
  // CR 608.2b: an object that changed zones since it was targeted is a new object — an illegal target.
  if ('zcc' in t && o.zcc !== t.zcc) return false;
  return canTargetObject(g, controller, spec, o, source);
}

/** Every legal choice for one target spec, players first. */
export function targetCandidates(g: GameState, controller: PlayerId, spec: TargetSpec, source: GameObject | null): Target[] {
  const out: Target[] = [];
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
          : zone === 'exile'
            ? g.zones.exile
            : g.order.flatMap((p) => g.zones[zone][p] ?? []);
    for (const id of ids) {
      const o = g.objects[id];
      if (o && canTargetObject(g, controller, spec, o, source)) out.push({ kind: 'object', object: id });
    }
  }
  return out;
}

export function targetPrompts(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null): TargetPrompt[] {
  return specs.map((spec) => ({
    text: spec.text,
    count: spec.count ?? 1,
    upTo: Boolean(spec.upTo),
    candidates: targetCandidates(g, controller, spec, source),
  }));
}

/** CR 601.2c / CR 115.6: whether enough legal targets exist for every spec. */
export function canChooseTargets(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null): boolean {
  return specs.every((spec) => spec.upTo || targetCandidates(g, controller, spec, source).length >= (spec.count ?? 1));
}

/** A default legal choice: the first candidates for each spec (UIs let the player change them). */
export function defaultTargets(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null): Target[][] | null {
  const out: Target[][] = [];
  for (const spec of specs) {
    const candidates = targetCandidates(g, controller, spec, source);
    const n = spec.count ?? 1;
    if (candidates.length < n && !spec.upTo) return null;
    out.push(candidates.slice(0, n));
  }
  return out;
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'player' ? a.player === (b as typeof a).player : a.object === (b as typeof a).object);

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
    const n = spec.count ?? 1;
    if (list.length > n || (!spec.upTo && list.length < n)) {
      throw new RulesError(`Choose ${spec.upTo ? 'up to ' : ''}${n} for “${spec.text}”.`);
    }
    list.forEach((t, j) => {
      if (list.slice(0, j).some((u) => sameTarget(t, u))) throw new RulesError(`The same target was chosen twice for “${spec.text}”.`);
      if (!isLegalTarget(g, controller, spec, t, source)) {
        const what = t.kind === 'player' ? (g.players[t.player]?.name ?? t.player) : g.objects[t.object] ? nameOf(g, g.objects[t.object]!) : t.object;
        throw new RulesError(`${what} isn’t a legal target for “${spec.text}”.`);
      }
    });
    return list.map((t): TargetRef => (t.kind === 'player' ? t : { kind: 'object', id: t.object, zcc: g.objects[t.object]!.zcc }));
  });
}
