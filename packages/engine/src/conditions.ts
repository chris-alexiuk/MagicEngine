import type { ConditionNode, ObjectFilter } from '@mtg/schema';
import { matchesFilter } from './characteristics.js';
import type { EffectContext } from './registry.js';
import { refObjects } from './resolve.js';
import type { GameEvent, GameState, PlayerId } from './types.js';
import { faceOf, livePlayers, zoneList } from './zones.js';

/** Condition tags the engine evaluates (schema CORE_NODES.conditions). */
export const CONDITION_TYPES: readonly string[] = [
  'kicked', 'cast_by_you', 'self_tapped', 'your_turn', 'count', 'life', 'hand', 'graveyard', 'this_turn', 'spells_last_turn',
  'counters', 'is', 'has_attached', 'monstrous', 'and', 'opponents', 'monarch', 'class_level', 'paid', 'arrived_since_upkeep',
];

/** What happened this turn, for conditions like "if a creature died this turn". */
export interface TurnLog {
  creatureDied: boolean;
  attacked: PlayerId[];
  gainedLife: PlayerId[];
  lostLife: PlayerId[];
  spellsCast: Record<PlayerId, number>;
  noncreatureCast: PlayerId[];
}

export function newTurnLog(): TurnLog {
  return { creatureDied: false, attacked: [], gainedLife: [], lostLife: [], spellsCast: {}, noncreatureCast: [] };
}

/** Records the events of one batch in the turn log. */
export function logTurnEvents(g: GameState, events: GameEvent[]): void {
  const log = g.turnLog;
  for (const e of events) {
    switch (e.type) {
      case 'moved':
        if (e.from === 'battlefield' && e.to === 'graveyard' && g.cards[e.card]?.faces[e.face]?.types.includes('Creature')) log.creatureDied = true;
        break;
      case 'attacks_declared':
        if (e.attacks.length && !log.attacked.includes(g.active)) log.attacked.push(g.active);
        break;
      case 'life':
        if (e.delta > 0 && !log.gainedLife.includes(e.player)) log.gainedLife.push(e.player);
        if (e.delta < 0 && !log.lostLife.includes(e.player)) log.lostLife.push(e.player);
        break;
      case 'cast': {
        log.spellsCast[e.player] = (log.spellsCast[e.player] ?? 0) + 1;
        const o = g.objects[e.object];
        const face = o ? g.cards[o.card]?.faces[o.face] : undefined;
        if (face && !face.types.includes('Creature') && !log.noncreatureCast.includes(e.player)) log.noncreatureCast.push(e.player);
        break;
      }
    }
  }
}

const cmp = (v: number, c: ConditionNode) =>
  (c.min === undefined || v >= Number(c.min)) &&
  (c.max === undefined || v <= Number(c.max)) &&
  (c.op === undefined || (c.op === 'ge' ? v >= Number(c.n) : c.op === 'le' ? v <= Number(c.n) : v === Number(c.n)));

/** Whether a condition is true now, for the spell or ability in `ctx`. */
export function evalCondition(cond: ConditionNode, ctx: EffectContext): boolean {
  const { g, controller } = ctx;
  const source = ctx.source;
  switch (cond.type) {
    case 'kicked':
      // CR 702.33d: the spell (or the permanent it became) was kicked.
      return Boolean(source?.cast?.kicked);
    case 'arrived_since_upkeep': {
      // CR 702.30a: it came under your control after your previous upkeep began (or you've had none).
      const upkeeps = g.players[controller]?.upkeeps ?? [];
      const previous = upkeeps.length >= 2 ? upkeeps[upkeeps.length - 2]! : -1;
      return Boolean(source && source.zone === 'battlefield' && (source.arrived ?? source.timestamp) > previous);
    }
    case 'paid':
      // "if its evoke cost was paid" — the spell, or the permanent it became (CR 601.2f).
      return Boolean(source?.cast?.paid?.includes(String(cond.cost)));
    case 'cast_by_you':
      return !source?.cast?.copy && source?.cast?.by === controller && (!cond.fromHand || source.cast.from === 'hand');
    case 'self_tapped':
      return Boolean(source && source.zone === 'battlefield' && source.tapped === cond.tapped);
    case 'your_turn':
      return (g.active === controller) === Boolean(cond.value);
    case 'count': {
      const players =
        cond.who === 'you' ? [controller] : livePlayers(g).filter((p) => p !== controller);
      const counts = players.map(
        (p) =>
          g.zones.battlefield.filter((id) => {
            const o = g.objects[id]!;
            return o.controller === p && matchesFilter(g, o, cond.filter as ObjectFilter, { controller: p, source: source ?? null });
          }).length,
      );
      // "your opponents control" — all of theirs together.
      if (cond.who === 'opponents_total') return cmp(counts.reduce((a, b) => a + b, 0), cond);
      // "an opponent controls" — any of them; "each opponent controls" — all of them.
      return cond.who === 'any_opponent' ? counts.some((n) => cmp(n, cond)) : counts.length > 0 && counts.every((n) => cmp(n, cond));
    }
    case 'life':
      // "an opponent has 10 or less life"
      if (cond.who === 'any_opponent') return livePlayers(g).some((p) => p !== controller && cmp(g.players[p]!.life, cond));
      if (cond.who === 'any_player') return livePlayers(g).some((p) => cmp(g.players[p]!.life, cond));
      return cmp(g.players[controller]!.life, cond);
    case 'hand': {
      const mine = zoneList(g, 'hand', controller).length;
      if (cond.than) {
        // "more cards in hand than each opponent" / "than an opponent"
        const theirs = livePlayers(g).filter((p) => p !== controller).map((p) => zoneList(g, 'hand', p).length);
        const beats = (n: number) => (cond.op === 'gt' ? mine > n : mine < n);
        return cond.than === 'each_opponent' ? theirs.every(beats) : theirs.some(beats);
      }
      return cmp(mine, cond);
    }
    case 'graveyard':
      return cmp(zoneList(g, 'graveyard', controller).length, cond);
    case 'this_turn': {
      const log = g.turnLog;
      switch (cond.event) {
        case 'creature_died':
          return log.creatureDied;
        case 'you_attacked':
          return log.attacked.includes(controller);
        case 'you_gained_life':
          return log.gainedLife.includes(controller);
        case 'opponent_lost_life':
          return log.lostLife.some((p) => p !== controller);
        case 'you_cast_noncreature':
          return log.noncreatureCast.includes(controller);
        default:
          return false;
      }
    }
    case 'spells_last_turn': {
      const counts = Object.values(g.lastTurnSpells);
      if (cond.max !== undefined) return counts.reduce((a, b) => a + b, 0) <= Number(cond.max);
      return counts.some((n) => n >= Number(cond.perPlayerMin));
    }
    case 'counters': {
      // "if it had no -1/-1 counters on it" asks about the object as it last existed on the battlefield (CR 603.10a).
      const of = cond.of as { ref: string };
      const lki = of.ref === 'trigger_object' ? ctx.trigger?.lki : undefined;
      const counters = lki?.counters ?? refObjects(ctx, cond.of as never)[0]?.counters ?? {};
      // No kind named: "a counter on it" — any kind.
      const n = cond.counter === undefined ? Object.values(counters).reduce((a, b) => a + b, 0) : (counters[String(cond.counter)] ?? 0);
      return cmp(n, cond);
    }
    case 'is': {
      // "~ is attacking", "enchanted creature is blue", "equipped creature is a Human".
      const [o] = refObjects(ctx, cond.of as never);
      return Boolean(o && matchesFilter(g, o, cond.filter as ObjectFilter, { controller, source: source ?? null }));
    }
    case 'has_attached': {
      // "~ is equipped" (CR 301.5) / "~ is enchanted" (CR 303.4): an Equipment or Aura is attached to it.
      if (!source || source.zone !== 'battlefield') return false;
      return g.zones.battlefield.some((id) => {
        const a = g.objects[id]!;
        return a.attachedTo?.id === source.id && a.attachedTo.zcc === source.zcc && faceOf(g, a).subtypes.includes(String(cond.subtype));
      });
    }
    case 'monstrous':
      // CR 701.37b
      return Boolean(source?.monstrous && source.zone === 'battlefield');
    case 'class_level': {
      // CR 716.2d: a permanent with no level is level 1.
      const level = source?.classLevel ?? 1;
      return cond.exactly !== undefined ? level === Number(cond.exactly) : level >= Number(cond.min ?? 1);
    }
    case 'monarch':
      // CR 725: "if you're the monarch" / "if there is no monarch".
      return cond.none ? !g.monarch : g.monarch === controller;
    case 'opponents':
      // CR 102.3: in multiplayer games, every other player is an opponent.
      return cmp(livePlayers(g).filter((p) => p !== controller).length, cond);
    case 'and':
      return (cond.all as ConditionNode[]).every((c) => evalCondition(c, ctx));
    default:
      return false;
  }
}
