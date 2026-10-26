import type { TriggeredAbility } from '@mtg/schema';
import { flatten, programRuns } from './program.js';
import { matchTrigger } from './registry.js';
import { apnap } from './resolve.js';
import { chooseTargets, targetCandidates, targetPrompts } from './targets.js';
import {
  RulesError,
  type GameEvent,
  type GameObject,
  type GameState,
  type ObjectId,
  type PendingTrigger,
  type PlayerId,
  type Target,
} from './types.js';
import { livePlayers } from './zones.js';

/**
 * Triggered abilities (CR 603). Events are checked in batches: after each action,
 * after each round of state-based actions, and before anyone gets priority.
 * CR 603.2: an ability triggers when an event matches its trigger condition.
 * CR 603.3: it's put on the stack the next time a player would receive priority.
 */

const TRIGGER_EVENTS = new Set<GameEvent['type']>([
  'moved', 'created', 'attacks_declared', 'blocks_declared', 'damage', 'step', 'cast', 'life', 'drew',
]);
/** CR 603.10a: leaves-the-battlefield abilities look back in time. */
const LOOK_BACK = new Set(['dies', 'leaves']);

const cursors = new WeakMap<GameEvent[], number>();

interface Candidate {
  o: GameObject;
  controller: PlayerId;
  face: number;
  left: boolean;
}

export function collectTriggers(g: GameState, events: GameEvent[]): void {
  const from = cursors.get(events) ?? 0;
  cursors.set(events, events.length);
  if (!g.started || g.over) return;
  const batch = events.slice(from).filter((e) => TRIGGER_EVENTS.has(e.type));
  if (!batch.length) return;

  // Permanents that left the battlefield in this batch can still trigger on leaving (CR 603.10a).
  const left = new Map<ObjectId, Candidate>();
  for (const e of batch) {
    if (e.type !== 'moved' || e.from !== 'battlefield') continue;
    const o = g.objects[e.object];
    if (o && o.zone !== 'battlefield') left.set(o.id, { o, controller: e.controller, face: e.face, left: true });
  }
  const present: Candidate[] = g.zones.battlefield.map((id) => {
    const o = g.objects[id]!;
    return { o, controller: o.controller, face: o.face, left: false };
  });
  const candidates = [...present, ...left.values()];

  for (const event of batch) {
    for (const c of candidates) {
      const face = g.cards[c.o.card]?.faces[c.face];
      if (!face) continue;
      face.abilities.forEach((ability, index) => {
        if (ability.kind !== 'triggered') return;
        if (c.left && !LOOK_BACK.has(ability.trigger.type)) return;
        if (!programRuns(ability)) return;
        if (ability.oncePerTurn && c.o.triggeredTurn?.[index] === g.turn) return;
        const infos = matchTrigger(ability.trigger, { g, event, source: c.o, controller: c.controller, sourceLeft: c.left });
        if (ability.oncePerTurn && infos.length) {
          // "This ability triggers only once each turn."
          (c.o.triggeredTurn ??= {})[index] = g.turn;
          infos.splice(1);
        }
        for (const info of infos) {
          // CR 603.3a: controlled by whoever controlled the source when it triggered.
          g.triggers.push({
            id: `t${g.nextId++}`,
            controller: c.controller,
            source: { id: c.o.id, zcc: c.o.zcc },
            sourceName: face.name,
            card: c.o.card,
            face: c.face,
            ability: index,
            info,
          });
        }
      });
    }
  }
}

function abilityOf(g: GameState, t: PendingTrigger): TriggeredAbility {
  return g.cards[t.card]!.faces[t.face]!.abilities[t.ability] as TriggeredAbility;
}

/**
 * CR 603.3b: in APNAP order, each player puts their triggered abilities on the stack
 * (the active player's go first, so they resolve last). The order among one player's
 * own abilities is their choice under rule 603.3b; here they go in the order they triggered.
 * Stops when a player has to choose modes or targets.
 */
export function stackTriggers(g: GameState, events: GameEvent[]): void {
  while (g.triggers.length && !g.pending && !g.over) {
    const live = livePlayers(g);
    g.triggers = g.triggers.filter((t) => live.includes(t.controller));
    const next = apnap(g)
      .map((p) => g.triggers.find((t) => t.controller === p))
      .find((t): t is PendingTrigger => Boolean(t));
    if (!next) return;
    putOnStack(g, next, events);
  }
}

/** Puts one trigger on the stack, asking for modes and targets when there's a real choice (CR 603.3c–d). */
function putOnStack(g: GameState, t: PendingTrigger, events: GameEvent[], answer?: { modes?: number[]; targets: Target[][] }): void {
  const ability = abilityOf(g, t);
  const source = g.objects[t.source.id] ?? null;
  const specs = ability.targets ?? [];

  if (!answer) {
    const modal = Boolean(ability.modes);
    const candidates = specs.map((s) => targetCandidates(g, t.controller, s, source));
    // CR 603.3d (via CR 601.2c): with too few legal targets the ability is removed from the stack.
    if (!modal && specs.some((s, i) => !s.upTo && candidates[i]!.length < (s.count ?? 1))) {
      g.triggers = g.triggers.filter((x) => x !== t);
      return;
    }
    const forced = !modal && specs.every((s, i) => (s.upTo ? candidates[i]!.length === 0 : candidates[i]!.length === (s.count ?? 1)));
    if (!forced) {
      g.pending = {
        kind: 'trigger_targets',
        player: t.controller,
        trigger: t.id,
        sourceName: t.sourceName,
        text: ability.text,
        prompts: targetPrompts(g, t.controller, specs, source),
        ...(ability.modes
          ? {
              modes: {
                min: ability.modes.min,
                max: ability.modes.max,
                options: ability.modes.options.map((m) => ({ text: m.text, prompts: targetPrompts(g, t.controller, m.targets ?? [], source) })),
              },
            }
          : {}),
      };
      return;
    }
    answer = { targets: candidates.map((c) => c) };
  }

  const program = flatten([ability], answer.modes);
  const targets = chooseTargets(g, t.controller, program.specs, answer.targets, source);
  g.triggers = g.triggers.filter((x) => x.id !== t.id);
  g.stack.push({
    kind: 'ability',
    id: `a${g.nextId++}`,
    source: t.source,
    sourceName: t.sourceName,
    controller: t.controller,
    text: ability.text,
    program,
    targets,
    x: 0,
    trigger: t.info,
  });
  events.push({ type: 'triggered', source: t.source.id, text: ability.text, controller: t.controller });
}

/** The answer to a trigger_targets prompt. */
export function answerTriggerTargets(g: GameState, player: PlayerId, modes: number[] | undefined, targets: Target[][], events: GameEvent[]): void {
  const p = g.pending;
  if (p?.kind !== 'trigger_targets' || p.player !== player) throw new RulesError('No triggered ability is waiting for targets.');
  const t = g.triggers.find((x) => x.id === p.trigger);
  if (!t) throw new RulesError('That triggered ability is gone.');
  const ability = abilityOf(g, t);
  if (ability.modes) {
    // CR 700.2b: a mode with no legal targets can't be chosen; if no mode can be, the ability is removed.
    if (!modes?.length && ability.modes.min > 0) {
      const anyLegal = ability.modes.options.some((m) =>
        (m.targets ?? []).every((s) => s.upTo || targetCandidates(g, t.controller, s, g.objects[t.source.id] ?? null).length >= (s.count ?? 1)),
      );
      if (!anyLegal) {
        g.pending = null;
        g.triggers = g.triggers.filter((x) => x !== t);
        return;
      }
    }
  }
  g.pending = null;
  putOnStack(g, t, events, { ...(modes ? { modes } : {}), targets });
}
