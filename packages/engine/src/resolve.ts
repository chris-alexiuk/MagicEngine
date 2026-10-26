import type { Amount, Ref } from '@mtg/schema';
import { matchesFilter } from './characteristics.js';
import { runEffect, type EffectContext } from './registry.js';
import { isLegalTarget } from './targets.js';
import type { ChoiceAnswer, DamageRecipient, GameEvent, GameObject, GameState, ObjectId, PlayerId, Resolution, StackEntry, TargetRef } from './types.js';
import { livePlayers, nextPlayer } from './zones.js';

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

function sourceOf(ctx: EffectContext): GameObject | null {
  const s = ctx.source;
  if (!s) return null;
  // CR 400.7: once it has changed zones it's a new object that "~" no longer refers to.
  return ctx.sourceZcc === undefined || s.zcc === ctx.sourceZcc ? s : null;
}

function targetObjects(ctx: EffectContext, index: number): GameObject[] {
  return (ctx.targets[index] ?? []).flatMap((t) => {
    if (t.kind !== 'object') return [];
    const o = ctx.g.objects[t.id];
    return o && o.zcc === t.zcc ? [o] : [];
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
      return o && r && o.zcc === r.zcc ? [o] : [];
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
    case 'players':
      return apnap(g).filter((p) => ref.who === 'each' || p !== ctx.controller);
    case 'target':
      return (ctx.targets[ref.index] ?? []).flatMap((t) => (t.kind === 'player' && live.includes(t.player) ? [t.player] : []));
    case 'trigger_player':
      return ctx.trigger?.player && live.includes(ctx.trigger.player) ? [ctx.trigger.player] : [];
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

export function amountOf(ctx: EffectContext, a: Amount | unknown): number {
  if (a === 'X') return ctx.x;
  return typeof a === 'number' ? a : 0;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function contextFor(g: GameState, entry: StackEntry, r: Resolution, events: GameEvent[], answer?: ChoiceAnswer): EffectContext {
  const sourceId = entry.kind === 'spell' ? entry.object : entry.source.id;
  const source = g.objects[sourceId];
  const ctx: EffectContext = {
    g,
    controller: entry.controller,
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
    const result = runEffect(node, contextFor(g, entry, r, events, pendingAnswer));
    pendingAnswer = undefined;
    if (typeof result === 'object' && 'ask' in result) {
      g.pending = result.ask;
      return false;
    }
    if (typeof result === 'object' && 'expand' in result) {
      r.effects.splice(r.index, 1, ...result.expand);
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
