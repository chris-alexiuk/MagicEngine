import type { Amount, AmountExpr, EffectNode, Ref } from '@mtg/schema';
import { chars, matchesFilter } from './characteristics.js';
import { runEffect, type EffectContext } from './registry.js';
import { isLegalTarget } from './targets.js';
import type { ChoiceAnswer, DamageRecipient, GameEvent, GameObject, GameState, ObjectId, PlayerId, Resolution, StackEntry, TargetRef } from './types.js';
import { battlefieldZcc, faceOf, livePlayers, nextPlayer } from './zones.js';

// ---------------------------------------------------------------------------
// References: who and what an effect acts on
// ---------------------------------------------------------------------------

/** Players in APNAP order (CR 101.4), starting with the active player. */
export function apnap(g: GameState): PlayerId[] {
  const live = livePlayers(g);
  const out: PlayerId[] = [];
  let p = g.active;
  for (let i = 0; i < g.order.length; i++) {
    if (live.includes(p) && !out.includes(p)) out.push(p);
    p = nextPlayer(g, p);
  }
  return out;
}

/** CR 400.7j: this resolution moved it to a public zone, so its other parts can find the new object. */
const foundNow = (ctx: EffectContext, o: GameObject) => ctx.resolution?.found?.[o.id] === o.zcc;

function sourceOf(ctx: EffectContext): GameObject | null {
  const s = ctx.source;
  if (!s) return null;
  // CR 400.7: once it has changed zones it's a new object that "~" no longer refers to (unless 400.7j finds it).
  return ctx.sourceZcc === undefined || s.zcc === ctx.sourceZcc || foundNow(ctx, s) ? s : null;
}

function targetObjects(ctx: EffectContext, index: number): GameObject[] {
  return (ctx.targets[index] ?? []).flatMap((t) => {
    if (t.kind !== 'object') return [];
    const o = ctx.g.objects[t.id];
    return o && (o.zcc === t.zcc || foundNow(ctx, o)) ? [o] : [];
  });
}

/** The objects a reference means right now (CR 608.2h). */
export function refObjects(ctx: EffectContext, ref: Ref): GameObject[] {
  const { g } = ctx;
  switch (ref.ref) {
    case 'self': {
      const s = sourceOf(ctx);
      return s ? [s] : [];
    }
    case 'target':
      return targetObjects(ctx, ref.index);
    case 'trigger_object': {
      const r = ctx.trigger?.object;
      const o = r ? g.objects[r.id] : undefined;
      return o && r && (o.zcc === r.zcc || foundNow(ctx, o)) ? [o] : [];
    }
    case 'attached': {
      const s = sourceOf(ctx);
      const r = s?.attachedTo;
      const o = r ? g.objects[r.id] : undefined;
      return o && r && o.zcc === r.zcc ? [o] : [];
    }
    case 'all': {
      const zone = ref.filter.zone ?? 'battlefield';
      const ids =
        zone === 'battlefield'
          ? g.zones.battlefield
          : zone === 'stack'
            ? g.stack.flatMap((e) => (e.kind === 'spell' ? [e.object] : []))
            : zone === 'exile'
              ? g.zones.exile
              : g.order.flatMap((p) => g.zones[zone][p] ?? []);
      return ids
        .map((id) => g.objects[id]!)
        .filter((o) => o && matchesFilter(g, o, ref.filter, { controller: ctx.controller, source: ctx.source ?? null }));
    }
    case 'exiled_with': {
      // CR 607.2a: cards in exile that this object's linked ability put there.
      const s = ctx.source;
      if (!s) return [];
      const zcc = battlefieldZcc(g, s);
      return g.zones.exile.map((id) => g.objects[id]!).filter((o) => o.exiledBy?.id === s.id && o.exiledBy.zcc === zcc);
    }
    default:
      return [];
  }
}

/** The players a reference means. */
export function refPlayers(ctx: EffectContext, ref: Ref): PlayerId[] {
  const { g } = ctx;
  const live = livePlayers(g);
  switch (ref.ref) {
    case 'you':
      return live.includes(ctx.controller) ? [ctx.controller] : [];
    case 'players': {
      const all = apnap(g).filter((p) => ref.who === 'each' || p !== ctx.controller);
      if (!ref.attacking) return all;
      // "each opponent attacking that player": controls a creature attacking them (CR 506.2).
      const defenders = refPlayers(ctx, ref.attacking);
      const attackers = Object.entries(g.combat?.attackers ?? {}).flatMap(([id, a]) =>
        a.target.kind === 'player' && defenders.includes(a.target.player) && g.objects[id] ? [g.objects[id]!.controller] : [],
      );
      return all.filter((p) => attackers.includes(p));
    }
    case 'target':
      return (ctx.targets[ref.index] ?? []).flatMap((t) => (t.kind === 'player' && live.includes(t.player) ? [t.player] : []));
    case 'trigger_player':
      return ctx.trigger?.player && live.includes(ctx.trigger.player) ? [ctx.trigger.player] : [];
    case 'enchanted_player': {
      // CR 303.4: the player the source Aura is attached to (as it last existed, if it has left).
      const s = ctx.source;
      const p = s?.attachedToPlayer ?? (s ? g.lastKnown?.[s.id]?.enchantedPlayer : undefined);
      return p && live.includes(p) ? [p] : [];
    }
    case 'controller_of':
    case 'owner_of': {
      const out: PlayerId[] = [];
      const of = ref.of;
      // CR 608.2h: an object that has left uses its last known information.
      const objects =
        of.ref === 'target'
          ? (ctx.targets[of.index] ?? []).flatMap((t) => (t.kind === 'object' ? [t] : []))
          : refObjects(ctx, of).map((o) => ({ kind: 'object' as const, id: o.id, zcc: o.zcc }));
      for (const t of objects) {
        const o = g.objects[t.id];
        if (!o) continue;
        const p = ref.ref === 'owner_of' ? o.owner : o.zcc === t.zcc ? o.controller : (ctx.resolution?.lki[o.id] ?? o.owner);
        if (live.includes(p) && !out.includes(p)) out.push(p);
      }
      return out;
    }
    default:
      return [];
  }
}

/** Damage and similar effects can point at players and objects alike ("any target"). */
export function refRecipients(ctx: EffectContext, ref: Ref): DamageRecipient[] {
  if (ref.ref === 'target') {
    return (ctx.targets[ref.index] ?? []).flatMap((t): DamageRecipient[] => {
      if (t.kind === 'player') return livePlayers(ctx.g).includes(t.player) ? [{ kind: 'player' as const, player: t.player }] : [];
      const o = ctx.g.objects[t.id];
      return o && o.zcc === t.zcc && o.zone === 'battlefield' ? [{ kind: 'permanent' as const, object: o.id }] : [];
    });
  }
  const players = refPlayers(ctx, ref).map((p) => ({ kind: 'player' as const, player: p }));
  const objects = refObjects(ctx, ref)
    .filter((o) => o.zone === 'battlefield')
    .map((o) => ({ kind: 'permanent' as const, object: o.id }));
  return [...players, ...objects];
}

/** Amount kinds the engine counts (schema CORE_NODES.amounts). */
export const AMOUNT_KINDS: readonly string[] = ['count', 'cards', 'stat', 'life', 'counters', 'players', 'devotion', 'x', 'event'];

/** The objects a reference meant, with the zone-change count it meant them at (for last-known information). */
function refRefs(ctx: EffectContext, ref: Ref): { id: ObjectId; zcc: number }[] {
  if (ref.ref === 'target') return (ctx.targets[ref.index] ?? []).flatMap((t) => (t.kind === 'object' ? [{ id: t.id, zcc: t.zcc }] : []));
  if (ref.ref === 'trigger_object') return ctx.trigger?.object ? [ctx.trigger.object] : [];
  if (ref.ref === 'self' && ctx.source) return [{ id: ctx.source.id, zcc: ctx.sourceZcc ?? ctx.source.zcc }];
  return refObjects(ctx, ref).map((o) => ({ id: o.id, zcc: o.zcc }));
}

/** CR 608.2h: an object's power/toughness now, or as it last existed on the battlefield. */
function statOf(ctx: EffectContext, ref: Ref, stat: 'power' | 'toughness' | 'mana_value'): number {
  const { g } = ctx;
  const [r] = refRefs(ctx, ref);
  if (!r) return 0;
  const o = g.objects[r.id];
  if (stat === 'mana_value') return o ? (g.cards[o.card]?.cmc ?? 0) : 0;
  if (o && o.zcc === r.zcc && o.zone === 'battlefield') return chars(g, o)[stat];
  const last = g.lastKnown?.[r.id];
  // A leaves-the-battlefield trigger points at the new object; the one just before it was on the battlefield.
  if (last && (last.zcc === r.zcc || (ref.ref === 'trigger_object' && last.zcc === r.zcc - 1))) return last[stat];
  return o ? chars(g, o)[stat] : 0;
}

/** CR 700.5: mana symbols of those colors among the mana costs of permanents you control (hybrid counts). */
function devotion(ctx: EffectContext, colors: string[]): number {
  let n = 0;
  for (const id of ctx.g.zones.battlefield) {
    const o = ctx.g.objects[id]!;
    if (o.controller !== ctx.controller) continue;
    for (const m of (faceOf(ctx.g, o).manaCost ?? '').matchAll(/\{([^}]+)\}/g)) {
      if (m[1]!.split('/').some((c) => colors.includes(c))) n++;
    }
  }
  return n;
}

function count(ctx: EffectContext, e: AmountExpr): number {
  const { g } = ctx;
  const source = ctx.source ?? null;
  switch (e.kind) {
    case 'count':
      return g.zones.battlefield.filter((id) => matchesFilter(g, g.objects[id]!, e.filter, { controller: ctx.controller, source })).length;
    case 'cards': {
      const players = e.who === 'you' ? [ctx.controller] : livePlayers(g).filter((p) => e.who === 'each' || p !== ctx.controller);
      const zone = e.zone;
      const ids = zone === 'exile' ? g.zones.exile : players.flatMap((p) => g.zones[zone][p] ?? []);
      return ids.filter((id) => {
        const o = g.objects[id]!;
        return e.zone !== 'exile' || players.includes(o.owner) ? !e.filter || matchesFilter(g, o, e.filter, { controller: ctx.controller, source, anyZone: true }) : false;
      }).length;
    }
    case 'stat':
      return statOf(ctx, e.of, e.stat);
    case 'life':
      return g.players[refPlayers(ctx, e.who)[0] ?? '']?.life ?? 0;
    case 'counters': {
      const [o] = refObjects(ctx, e.of);
      const counters = o?.counters ?? {};
      return e.counter ? (counters[e.counter] ?? 0) : Object.values(counters).reduce((a, b) => a + b, 0);
    }
    case 'players':
      return livePlayers(g).filter((p) => e.who === 'each' || p !== ctx.controller).length;
    case 'devotion':
      return devotion(ctx, e.colors);
    case 'x':
      return ctx.x;
    case 'event':
      // "that much", "that many": how much the trigger event was.
      return ctx.trigger?.amount ?? 0;
    default:
      return 0;
  }
}

export function amountOf(ctx: EffectContext, a: Amount | unknown): number {
  if (a === 'X') return ctx.x;
  if (typeof a === 'number') return a;
  if (a && typeof a === 'object' && 'kind' in a) {
    const e = a as AmountExpr;
    return count(ctx, e) * (e.times ?? 1) + (e.plus ?? 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function contextFor(g: GameState, entry: StackEntry, r: Resolution, events: GameEvent[], answer?: ChoiceAnswer, node?: EffectNode): EffectContext {
  const sourceId = entry.kind === 'spell' ? entry.object : entry.source.id;
  const source = g.objects[sourceId];
  const ctx: EffectContext = {
    g,
    // An effect done by another player as if they were "you" ("does the same").
    controller: (node?.asPlayer as PlayerId | undefined) ?? entry.controller,
    events,
    targets: r.targets,
    x: entry.x,
    memo: r.memo,
    resolution: r,
  };
  if (source) ctx.source = source;
  if (entry.kind === 'ability') {
    ctx.sourceZcc = entry.source.zcc;
    if (entry.trigger) ctx.trigger = entry.trigger;
  } else if (source) ctx.sourceZcc = source.zcc;
  if (answer) ctx.answer = answer;
  return ctx;
}

/**
 * CR 608.2b: as it starts to resolve, a spell or ability rechecks its targets.
 * Returns the targets still legal, or null if it had targets and none are legal.
 */
export function recheckTargets(g: GameState, entry: StackEntry): TargetRef[][] | null {
  const program = entry.program!;
  // Nothing targeted: keep any objects it was bound to (a delayed trigger, CR 603.7c).
  if (program.specs.length === 0) return entry.targets;
  const sourceId = entry.kind === 'spell' ? entry.object : entry.source.id;
  const source = g.objects[sourceId] ?? null;
  let chosen = 0;
  let legal = 0;
  const out = program.specs.map((spec, i) =>
    (entry.targets[i] ?? []).filter((t) => {
      chosen++;
      const ok = isLegalTarget(g, entry.controller, spec, t, source);
      if (ok) legal++;
      return ok;
    }),
  );
  return chosen > 0 && legal === 0 ? null : out;
}

export function startResolution(g: GameState, entry: StackEntry, targets: TargetRef[][]): void {
  const lki: Record<ObjectId, PlayerId> = {};
  for (const list of targets) for (const t of list) if (t.kind === 'object' && g.objects[t.id]) lki[t.id] = g.objects[t.id]!.controller;
  g.resolving = { entry, effects: structuredClone(entry.program!.effects), index: 0, memo: {}, targets, lki };
}

/**
 * Runs the resolving entry's effects in order (CR 608.2c) until it finishes or an effect
 * needs a player's choice. Returns true when every effect has been carried out.
 */
export function runResolution(g: GameState, events: GameEvent[], answer?: ChoiceAnswer): boolean {
  const r = g.resolving!;
  const entry = r.entry;
  let pendingAnswer = answer;
  while (r.index < r.effects.length) {
    const node = r.effects[r.index]!;
    const result = runEffect(node, contextFor(g, entry, r, events, pendingAnswer, node));
    pendingAnswer = undefined;
    if (typeof result === 'object' && 'ask' in result) {
      g.pending = result.ask;
      return false;
    }
    if (typeof result === 'object' && 'expand' in result) {
      // What an effect done "as" another player expands into is done by them too.
      const as = node.asPlayer;
      r.effects.splice(r.index, 1, ...(as ? result.expand.map((e) => (e.asPlayer ? e : { ...e, asPlayer: as })) : result.expand));
      r.memo = {};
      continue;
    }
    r.index++;
    r.memo = {};
    if (g.over) break;
  }
  g.resolving = null;
  return true;
}
