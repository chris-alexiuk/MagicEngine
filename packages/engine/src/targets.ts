import type { EffectNode, KeywordInstance, ObjectFilter, TargetSpec } from '@mtg/schema';
import type { EffectContext } from './registry.js';
import { amountOf } from './resolve.js';
import { chars, creatureTypesOf, filterZones, hasHexproofFrom, hasKeyword, hasProtectionFrom, matchesFilter } from './characteristics.js';
import { RulesError, type GameObject, type GameState, type PlayerId, type StackEntry, type Target, type TargetPrompt, type TargetRef, type TriggerInfo } from './types.js';
import { playerProtectedFrom, playerRule } from './player-rules.js';
import { faceOf, livePlayers, manaValueOf, nameOf, zoneList } from './zones.js';

/**
 * Targeting (CR 115). `source` is the object the spell or ability comes from: the
 * spell itself for a spell, or the permanent whose ability it is.
 */

/**
 * Whether the targets being chosen or checked are an ability's rather than a spell's (CR 115.1, 113.1): Shanna, Sisay's
 * Legacy "can't be the target of abilities your opponents control"; Dense Foliage: "Creatures can't be the targets of
 * spells."
 */
let byAbility = false;
export function targetingAs<T>(ability: boolean, fn: () => T): T {
  const before = byAbility;
  byAbility = ability;
  try {
    return fn();
  } finally {
    byAbility = before;
  }
}

/** CR 608.2b: targets being rechecked as a spell or ability resolves (Keeper of the Flame: "as you activate this ability" isn't). */
let resolving = false;
export function checkingOnResolution<T>(fn: () => T): T {
  const before = resolving;
  resolving = true;
  try {
    return fn();
  } finally {
    resolving = before;
  }
}

/** Rix Maadi Guildmage: "target player who lost life this turn"; Keeper of the Flame: "who has more life than you do". */
function playerWhoOk(g: GameState, controller: PlayerId, who: NonNullable<TargetSpec['who']>, player: PlayerId, source: GameObject | null): boolean {
  if (who.lostLife && !((g.turnLog.lifeLost?.[player] ?? 0) > 0)) return false;
  if (who.attacked && !g.turnLog.attacked.includes(player)) return false;
  // Hope of Ghirapur sacrifices itself as it's activated: what it did this turn stays done (CR 608.2b).
  if (who.combatDamagedBySource && !resolving && !(source && (g.turnLog.playerDamagedBy?.[player] ?? []).includes(`c:${source.id}:${source.zcc}`))) return false;
  if (who.more && !(who.asActivated && resolving)) {
    const stat = (p: PlayerId): number => {
      switch (who.more!.stat) {
        case 'life':
          return g.players[p]!.life;
        case 'hand':
          return zoneList(g, 'hand', p).length;
        case 'creatures':
          return g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && !g.objects[id]!.phasedOut && chars(g, g.objects[id]!).types.includes('Creature')).length;
        case 'graveyard_creatures':
          return zoneList(g, 'graveyard', p).filter((id) => faceOf(g, g.objects[id]!).types.includes('Creature')).length;
      }
    };
    const diff = who.more.fewer ? stat(controller) - stat(player) : stat(player) - stat(controller);
    if (diff < Math.max(1, who.more.by ?? 1)) return false;
  }
  return true;
}

/** The event a triggered ability's targets are being chosen or checked for (Scrap Trawler: "with lesser mana value"). */
let triggerInfo: TriggerInfo | undefined;
export function withTriggerInfo<T>(info: TriggerInfo | undefined, fn: () => T): T {
  const before = triggerInfo;
  triggerInfo = info;
  try {
    return fn();
  } finally {
    triggerInfo = before;
  }
}

/**
 * Alesha: "target creature card with mana value less than or equal to Alesha's power", Lay Down Arms: "… less than or
 * equal to the number of Plains you control" — counted whenever the target is checked (as it's chosen, and again as it
 * resolves, CR 608.2b).
 */
/**
 * CR 601.2b–c: X is announced before targets are chosen, so "target creature with mana value X or less" is checked with
 * that X (and again as it resolves, CR 608.2b).
 */
/** Comet Storm: "then choose another target for each time this spell was kicked" — the kicks announced (CR 601.2b–c). */
let targetKicks = 0;
export function withTargetKicks<T>(kicks: number, fn: () => T): T {
  const before = targetKicks;
  targetKicks = kicks;
  try {
    return fn();
  } finally {
    targetKicks = before;
  }
}

let targetX: number | undefined;
export function withTargetX<T>(x: number | undefined, fn: () => T): T {
  const before = targetX;
  targetX = x;
  try {
    return fn();
  } finally {
    targetX = before;
  }
}

/**
 * Huntmaster of the Fells: "target opponent or planeswalker and … up to one target creature that player or that
 * planeswalker's controller controls" — the targets already chosen, as a later one is checked against them
 * (unknown while each target's candidates are listed on their own).
 */
let priorTargets: readonly (readonly (Target | TargetRef)[])[] | undefined;
export function withPriorTargets<T>(list: readonly (readonly (Target | TargetRef)[])[] | undefined, fn: () => T): T {
  const before = priorTargets;
  priorTargets = list;
  try {
    return fn();
  } finally {
    priorTargets = before;
  }
}

/** The earlier target a "that player controls" filter refers to: "target player", "that planeswalker's controller", "that creature's controller". */
export function controlledByTargetIndex(filter: ObjectFilter | undefined): number | undefined {
  let r = filter?.controlledBy as { ref?: string; index?: number; of?: unknown } | undefined;
  if (r && (r.ref === 'player_or_controller' || r.ref === 'controller_of')) r = r.of as typeof r;
  return r?.ref === 'target' ? (r.index ?? 0) : undefined;
}

/** Gaea's Blessing: "up to three target cards from their graveyard" — the earlier target whose graveyard it is. */
export function ownedByTargetIndex(filter: ObjectFilter | undefined): number | undefined {
  const r = filter?.ownedBy as { ref?: string; index?: number } | undefined;
  return r?.ref === 'target' ? (r.index ?? 0) : undefined;
}

/** The player a chosen target stands for: the player, or the permanent's controller (a card's owner, CR 108.4a). */
function playerOfTarget(g: GameState, t: Target | TargetRef | undefined): PlayerId | undefined {
  if (!t || t.kind === 'ability') return undefined;
  if (t.kind === 'player') return t.player;
  const o = g.objects['id' in t ? t.id : t.object];
  return o ? (o.zone === 'battlefield' ? o.controller : o.owner) : undefined;
}

function countedFilter(g: GameState, controller: PlayerId, given: ObjectFilter, source: GameObject | null): ObjectFilter {
  // Ink-Eyes: "target creature card from that player's graveyard" — the player the trigger is about.
  let filter = given;
  if (filter.ownedBy) {
    const { ownedBy, ...rest } = filter;
    const r = ownedBy as { ref?: string; index?: number };
    // Gaea's Blessing: "up to three target cards from their graveyard" — the earlier target player's (not yet known: any).
    if (r.ref === 'target') filter = priorTargets ? { ...rest, ownerPlayer: playerOfTarget(g, priorTargets[r.index ?? 0]?.[0]) ?? '\u0000none' } : rest;
    else {
      const player = r.ref === 'trigger_player' ? triggerInfo?.player : undefined;
      filter = { ...rest, ownerPlayer: player ?? '\u0000none' };
    }
  }
  // "destroy target artifact that player controls" (the player the trigger is about); "… target creature that player
  // controls" (an earlier target). Not yet known (each target's candidates listed on their own): any player.
  if (filter.controlledBy) {
    const { controlledBy, ...rest } = filter;
    const index = controlledByTargetIndex(filter);
    const known = (controlledBy as { ref?: string }).ref === 'trigger_player' ? Boolean(triggerInfo) : index !== undefined && Boolean(priorTargets);
    const player = !known ? undefined : index === undefined ? triggerInfo!.player : playerOfTarget(g, priorTargets![index]?.[0]);
    filter = known ? { ...rest, controllerPlayer: player ?? '\u0000none' } : rest;
  }
  // Ordruun Mentor: "target creature that's attacking that player" — the player the trigger is about.
  if (filter.attackingPlayerRef) {
    const { attackingPlayerRef: _a, ...rest } = filter;
    filter = triggerInfo?.player ? { ...rest, attackingPlayer: triggerInfo.player } : rest;
  }
  // Due Diligence: "target creature you control other than enchanted creature" — the one this Aura is attached to.
  if (filter.otherThan && (filter.otherThan as { ref?: string }).ref === 'attached') {
    const { otherThan: _o, ...rest } = filter;
    filter = { ...rest, notObject: source?.attachedTo?.id ?? '' };
  }
  // Fiery Annihilation: "target Equipment attached to that creature" — an earlier target (not yet known: any).
  if (filter.attachedToRef) {
    const { attachedToRef, ...rest } = filter;
    const r = attachedToRef as { ref?: string; index?: number };
    const t = r.ref === 'target' && priorTargets ? priorTargets[r.index ?? 0]?.[0] : undefined;
    const id = t && t.kind === 'object' ? ((t as { id?: string }).id ?? (t as { object?: string }).object) : undefined;
    const o = id ? g.objects[id] : undefined;
    filter = r.ref === 'target' && priorTargets ? { ...rest, attachedToObject: o ? { id: o.id, zcc: o.zcc } : { id: '', zcc: -1 } } : rest;
  }
  const keys = (['power', 'toughness', 'manaValue'] as const).filter((k) => typeof filter[k]?.n === 'object' || (filter[k]?.n === 'X' && targetX !== undefined));
  if (!keys.length) return filter;
  const ctx = { g, controller, ...(source ? { source } : {}), events: [], targets: [], x: targetX ?? 0, memo: {}, ...(triggerInfo ? { trigger: triggerInfo } : {}) } as EffectContext;
  const out: ObjectFilter = { ...filter };
  for (const k of keys) out[k] = { ...filter[k]!, n: filter[k]!.n === 'X' ? targetX! : amountOf(ctx, filter[k]!.n) };
  return out;
}

function untargetableBy(g: GameState, k: KeywordInstance, controller: PlayerId, source: GameObject | null): boolean {
  if (k.by === 'spells' && byAbility) return false;
  if (k.by === 'abilities' && !byAbility) return false;
  // "your opponents control": the opponents of the player the keyword was granted for.
  if (k.opponents && (!k.you || k.you === controller)) return false;
  if (k.filter && !(source && matchesFilter(g, source, k.filter, { controller: source.controller, source, anyZone: true }))) return false;
  return true;
}

function canTargetObject(g: GameState, controller: PlayerId, spec: TargetSpec, o: GameObject, source: GameObject | null): boolean {
  // CR 115.5: a spell or ability on the stack can't target itself.
  if (source && source.id === o.id && o.zone === 'stack') return false;
  const filter = countedFilter(g, controller, spec.filter ?? {}, source);
  if (!matchesFilter(g, o, filter, { controller, source })) return false;
  if (o.zone === 'battlefield') {
    // CR 702.18a: shroud — can't be the target of spells or abilities.
    if (hasKeyword(g, o, 'shroud')) return false;
    // CR 702.11b: hexproof — can't be the target of spells or abilities its controller's opponents control.
    if (o.controller !== controller && hasKeyword(g, o, 'hexproof')) return false;
    if (o.controller !== controller && source && hasHexproofFrom(g, o, source)) return false;
    // Vines of Vastwood: "can't be the target of spells or abilities your opponents control" — the granting player's.
    if (chars(g, o).keywords.some((k) => k.id === 'untargetable_by_opponents' && k.you && k.you !== controller)) return false;
    // Shanna: "can't be the target of abilities your opponents control"; Gaea's Revenge: "… of nongreen spells or abilities
    // from nongreen sources"; Tetsuo Umezawa: "… of Aura spells".
    if (chars(g, o).keywords.some((k) => k.id === 'untargetable' && untargetableBy(g, k, controller, source))) return false;
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
      // Outwit: "Counter target spell that targets a player." — any player.
      if (t.kind === 'player') return Boolean(want.anyPlayer) || (Boolean(want.you) && t.player === controller);
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

function canTargetPlayer(g: GameState, controller: PlayerId, spec: TargetSpec, player: PlayerId, source: GameObject | null): boolean {
  if (!livePlayers(g).includes(player)) return false;
  if (spec.player === 'opponent' && player === controller) return false;
  if (spec.player === 'you' && player !== controller) return false;
  // The Lord of Pain: "choose another target player" — not the player who cast that spell.
  if (spec.notTriggerPlayer && triggerInfo?.player === player) return false;
  // Needle Drop: "any target that was dealt damage this turn".
  if (spec.damagedThisTurn && !((g.turnLog.damageTaken?.[player] ?? 0) > 0)) return false;
  if (spec.who && !playerWhoOk(g, controller, spec.who, player, source)) return false;
  // CR 702.11c: a player with hexproof can't be the target of spells or abilities their opponents control;
  // CR 702.18: with shroud, of any spell or ability.
  if (playerRule(g, player, 'shroud')) return false;
  // CR 702.16j: a player with protection from everything can't be the target of spells or abilities.
  if (playerRule(g, player, 'protection_everything')) return false;
  // CR 702.16b: nor of spells or abilities from a source with a quality they have protection from.
  if (source && playerProtectedFrom(g, player, source)) return false;
  if (player !== controller && playerRule(g, player, 'hexproof')) return false;
  // Veil of Summer: "hexproof from blue and from black" — not by sources of those colors their opponents control.
  if (player !== controller && source && (g.playerEffects ?? []).some((e) => e.player === player && e.rule === 'hexproof_from' && e.lastTurn >= g.turn && e.filter && matchesFilter(g, source, e.filter, { controller: player, anyZone: true }))) return false;
  return true;
}

export function isLegalTarget(
  g: GameState,
  controller: PlayerId,
  spec: TargetSpec,
  t: TargetRef | Target,
  source: GameObject | null,
): boolean {
  if (t.kind === 'player') return spec.what !== 'object' && spec.what !== 'ability' && canTargetPlayer(g, controller, spec, t.player, source);
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
    for (const p of livePlayers(g)) if (canTargetPlayer(g, controller, spec, p, source)) out.push({ kind: 'player', player: p });
  }
  if (spec.what !== 'player') {
    const ids = filterZones(spec.filter).flatMap((zone) =>
      zone === 'battlefield'
        ? g.zones.battlefield
        : zone === 'stack'
          ? g.stack.flatMap((e) => (e.kind === 'spell' ? [e.object] : []))
          : zone === 'exile' || zone === 'command'
            ? g.zones[zone]
            : g.order.flatMap((p) => g.zones[zone][p] ?? []),
    );
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
export function targetCount(g: GameState, controller: PlayerId, spec: TargetSpec, x = 0, source: GameObject | null = null): number {
  if (spec.countX) return Math.max(0, x);
  if (spec.countAmount) return Math.max(0, amountOf({ g, controller, source, events: [], targets: [], x, memo: {} } as EffectContext, spec.countAmount));
  if (spec.plusKicks) return (spec.count ?? 1) + targetKicks;
  return spec.perPlayer ? perPlayerSet(g, controller, spec).length : (spec.count ?? 1);
}

/**
 * How many targets a spec needs at least: "up to" any minimum; per-player specs one for each player who has a
 * legal one (at least one); otherwise all of them.
 */
export function targetsRequired(g: GameState, controller: PlayerId, spec: TargetSpec, candidates: readonly Target[], x = 0): number {
  if (spec.upTo) return spec.min ?? 0;
  if (spec.countX) return Math.max(0, x);
  if (spec.plusKicks) return (spec.count ?? 1) + targetKicks;
  if (spec.perPlayer) {
    const players = new Set(candidates.map((t) => whoseTarget(g, t)));
    return Math.max(1, perPlayerSet(g, controller, spec).filter((p) => players.has(p)).length);
  }
  return spec.count ?? 1;
}

export function targetPrompts(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x = 0): TargetPrompt[] {
  return withTargetX(x, () => targetPromptsNow(g, controller, specs, source, x));
}

function targetPromptsNow(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x: number): TargetPrompt[] {
  return specs.map((spec) => {
    const candidates = targetCandidates(g, controller, spec, source);
    const min = spec.perPlayer ? targetsRequired(g, controller, spec, candidates) : spec.upTo ? spec.min : undefined;
    return {
      text: spec.text,
      count: targetCount(g, controller, spec, x, source),
      upTo: Boolean(spec.upTo || spec.perPlayer),
      // "one, two, or three targets": at least this many (CR 601.2c).
      ...(min ? { min } : {}),
      ...(spec.sameOwner ? { sameOwner: true as const } : {}),
      ...(spec.perPlayer ? { perPlayer: true as const } : {}),
      ...((controlledByTargetIndex(spec.filter) ?? ownedByTargetIndex(spec.filter)) !== undefined ? { controlledByTarget: (controlledByTargetIndex(spec.filter) ?? ownedByTargetIndex(spec.filter))! } : {}),
      ...((spec.filter?.attachedToRef as { ref?: string } | undefined)?.ref === 'target' ? { attachedToTarget: (spec.filter!.attachedToRef as { index?: number }).index ?? 0 } : {}),
      candidates,
    };
  });
}

/** CR 601.2c / CR 115.6: whether enough legal targets exist for every spec. */
export function canChooseTargets(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x = 0): boolean {
  return withTargetX(x, () => canChooseTargetsNow(g, controller, specs, source, x));
}

function canChooseTargetsNow(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x: number): boolean {
  return specs.every((spec) => {
    const candidates = targetCandidates(g, controller, spec, source);
    const need = targetsRequired(g, controller, spec, candidates, x);
    return (related(spec) ? relatedPick(g, spec, candidates, need).length : candidates.length) >= need;
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
export function defaultTargets(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x = 0): Target[][] | null {
  return withTargetX(x, () => defaultTargetsNow(g, controller, specs, source, x));
}

function defaultTargetsNow(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x: number): Target[][] | null {
  const out: Target[][] = [];
  return withPriorTargets(out, () => defaultTargetsInto(g, controller, specs, source, x, out));
}

function defaultTargetsInto(g: GameState, controller: PlayerId, specs: TargetSpec[], source: GameObject | null, x: number, out: Target[][]): Target[][] | null {
  for (const spec of specs) {
    const candidates = targetCandidates(g, controller, spec, source).filter((t) => !another(spec) || !out.flat().some((u) => sameTarget(t, u)));
    const n = targetCount(g, controller, spec, x, source);
    if (candidates.length < targetsRequired(g, controller, spec, candidates, x)) return null;
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
    // Agadeem's Awakening, Run Away Together, Secret Tunnel: a set of targets related as the spec says.
    if (related(spec)) {
      const pick = relatedPick(g, spec, candidates, n);
      if (pick.length < targetsRequired(g, controller, spec, candidates, x)) return null;
      out.push(pick);
      continue;
    }
    out.push(candidates.slice(0, n));
  }
  return out;
}

/** Whether a spec's targets must be related to each other (CR 115.3: each instance of "target" is checked as a whole). */
const related = (spec: TargetSpec) => Boolean(spec.distinctManaValues || spec.differentControllers || spec.shareCreatureType || spec.shareCardType || spec.maxTotalMV !== undefined);

/** Run Away Together, Secret Tunnel, Agadeem's Awakening: whether these targets are related as the spec says. */
export function targetsRelated(g: GameState, spec: TargetSpec, list: Target[]): boolean {
  const objs = list.map((t) => (t.kind === 'object' ? g.objects[t.object] : undefined));
  if (objs.some((o) => !o)) return !related(spec);
  const os = objs as GameObject[];
  if (spec.distinctManaValues && new Set(os.map((o) => manaValueOf(g, o))).size !== os.length) return false;
  if (spec.maxTotalMV !== undefined && os.reduce((n, o) => n + manaValueOf(g, o), 0) > (spec.maxTotalMV === 'X' ? (targetX ?? 0) : spec.maxTotalMV)) return false;
  // "controlled by different players" — off the battlefield, owned by (CR 108.4a).
  if (spec.differentControllers && new Set(os.map((o) => (o.zone === 'battlefield' ? o.controller : o.owner))).size !== os.length) return false;
  if (spec.shareCreatureType && os.length > 1) {
    const sets = os.map((o) => creatureTypesOf(chars(g, o)));
    if (!sets[0]!.some((t) => sets.every((s) => s.includes(t)))) return false;
  }
  if (spec.shareCardType && os.length > 1) {
    const sets = os.map((o) => chars(g, o).types);
    if (!sets[0]!.some((t) => sets.every((s) => s.includes(t)))) return false;
  }
  return true;
}

/** The largest related set of these candidates, up to `n` (greedy, by type for "share a … type"). */
export function relatedPick(g: GameState, spec: TargetSpec, candidates: Target[], n: number): Target[] {
  if (!related(spec)) return candidates.slice(0, n);
  const greedy = (pool: Target[]) => {
    const out: Target[] = [];
    for (const t of pool) {
      if (out.length >= n) break;
      if (targetsRelated(g, spec, [...out, t])) out.push(t);
    }
    return out;
  };
  if (!spec.shareCreatureType && !spec.shareCardType) return greedy(candidates);
  // Try each type the candidates have: the one with the most of them.
  const typesOf = (t: Target) => {
    const o = t.kind === 'object' ? g.objects[t.object] : undefined;
    return o ? (spec.shareCreatureType ? creatureTypesOf(chars(g, o)) : chars(g, o).types) : [];
  };
  let best: Target[] = [];
  for (const type of new Set(candidates.flatMap(typesOf))) {
    const pick = greedy(candidates.filter((t) => typesOf(t).includes(type)));
    if (pick.length > best.length) best = pick;
    if (best.length >= n) break;
  }
  return best;
}

/** "another target creature": not one chosen for an earlier "target" of the same spell or ability.
 * Arm the Cathars, Relic Crush: "… and up to one other target …" — the same (CR 115.3). */
const another = (spec: TargetSpec) => /\b(?:another|other) target\b/i.test(spec.text ?? '');

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
  x = 0,
): TargetRef[][] {
  return withTargetX(x, () => chooseTargetsNow(g, controller, specs, chosen, source, x));
}

function chooseTargetsNow(g: GameState, controller: PlayerId, specs: TargetSpec[], chosen: Target[][] | undefined, source: GameObject | null, x: number): TargetRef[][] {
  return withPriorTargets(chosen ?? [], () => chooseTargetsGiven(g, controller, specs, chosen, source, x));
}

function chooseTargetsGiven(g: GameState, controller: PlayerId, specs: TargetSpec[], chosen: Target[][] | undefined, source: GameObject | null, x: number): TargetRef[][] {
  const given = chosen ?? [];
  if (given.length !== specs.length) {
    throw new RulesError(specs.length ? `Choose targets: ${specs.map((s) => s.text).join('; ')}.` : 'This doesn’t take targets.');
  }
  return specs.map((spec, i) => {
    const list = given[i]!;
    const n = targetCount(g, controller, spec, x, source);
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
    // Agadeem's Awakening: "that each have a different mana value"; "controlled by different players"; "that share a
    // creature type".
    if (related(spec) && !targetsRelated(g, spec, list)) {
      const how = spec.distinctManaValues ? 'each have a different mana value' : spec.differentControllers ? 'be controlled by different players' : spec.shareCreatureType ? 'share a creature type' : spec.shareCardType ? 'share a card type' : `have total mana value ${spec.maxTotalMV === 'X' ? (targetX ?? 0) : spec.maxTotalMV} or less`;
      throw new RulesError(`The targets for “${spec.text}” must ${how}.`);
    }
    list.forEach((t, j) => {
      if (list.slice(0, j).some((u) => sameTarget(t, u))) throw new RulesError(`The same target was chosen twice for “${spec.text}”.`);
      if (another(spec) && given.slice(0, i).flat().some((u) => sameTarget(t, u))) throw new RulesError(`“${spec.text}” must be different from the other targets.`);
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
