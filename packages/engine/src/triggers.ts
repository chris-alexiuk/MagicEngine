import { copyChoicePending } from './as-enters.js';
import type { TriggeredAbility, TriggerNode } from '@mtg/schema';
import { abilitiesOf, matchesFilter, printedAbilities, withCharsCache } from './characteristics.js';
import { evalCondition, logTurnEvents } from './conditions.js';
import type { EffectContext } from './registry.js';
import { flatten, programRuns } from './program.js';
import { matchTrigger } from './registry.js';
import { apnap } from './resolve.js';
import { chooseTargets, divisionFor, targetCandidates, targetPrompts } from './targets.js';
import {
  RulesError,
  type GameEvent,
  type GameObject,
  type GameState,
  type ObjectId,
  type PendingTrigger,
  type PlayerId,
  type StackEntry,
  type Target,
  type TriggerInfo,
} from './types.js';
import { faceOf, livePlayers, abilitySources } from './zones.js';
import { faceDownFace } from './face-down.js';

/**
 * Triggered abilities (CR 603). Events are checked in batches: after each action,
 * after each round of state-based actions, and before anyone gets priority.
 * CR 603.2: an ability triggers when an event matches its trigger condition.
 * CR 603.3: it's put on the stack the next time a player would receive priority.
 */

const TRIGGER_EVENTS = new Set<GameEvent['type']>([
  'moved', 'created', 'attacks_declared', 'blocks_declared', 'damage', 'step', 'cast', 'life', 'drew', 'became_target', 'counters',
  'class_level', 'turned_face_up', 'discarded', 'day_night', 'tapped', 'ability_activated', 'exerted', 'clashed',
]);
const LOOK_BACK = new Set(['dies', 'leaves']);
/** CR 603.10a: leaves-the-battlefield abilities "look back in time" ("When ~ enters or dies" too). */
const looksBack = (t: TriggerNode): boolean => LOOK_BACK.has(t.type) || (t.type === 'either' && ((t.of as TriggerNode[] | undefined) ?? []).some(looksBack));

const cursors = new WeakMap<GameEvent[], number>();

interface Candidate {
  o: GameObject;
  controller: PlayerId;
  face: number;
  left: boolean;
}

export function collectTriggers(g: GameState, events: GameEvent[]): void {
  // Matching doesn't change characteristics, so lookups share one cache.
  withCharsCache(() => collect(g, events));
}

function collect(g: GameState, events: GameEvent[]): void {
  const from = cursors.get(events) ?? 0;
  cursors.set(events, events.length);
  if (!g.started || g.over) return;
  // CR 707.5 / 603.6d: a permanent entering as a copy triggers as the copy — wait until it has chosen.
  if (copyChoicePending(g)) {
    (g.heldEvents ??= []).push(...events.slice(from));
    return;
  }
  const fresh = g.heldEvents?.length ? [...g.heldEvents, ...events.slice(from)] : events.slice(from);
  delete g.heldEvents;
  logTurnEvents(g, fresh);
  const batch = fresh.filter((e) => TRIGGER_EVENTS.has(e.type));
  if (!batch.length) return;
  collectDelayed(g, batch);
  collectMonarch(g, batch);
  collectSpeed(g, batch);
  collectExileKeywords(g, batch);

  // Permanents that left the battlefield in this batch can still trigger on leaving (CR 603.10a).
  const left = new Map<ObjectId, Candidate>();
  for (const e of batch) {
    if (e.type !== 'moved' || e.from !== 'battlefield') continue;
    const o = g.objects[e.object];
    if (o && o.zone !== 'battlefield') left.set(o.id, { o, controller: e.controller, face: e.face, left: true });
  }
  const present: Candidate[] = abilitySources(g).map((id) => {
    const o = g.objects[id]!;
    return { o, controller: o.controller, face: o.face, left: false };
  });
  // CR 113.6m: cards in graveyards whose abilities say they work from there ("return ~ from your graveyard…").
  const inGraveyards: Candidate[] = [];
  for (const p of Object.keys(g.zones.graveyard)) {
    for (const id of g.zones.graveyard[p]!) {
      const o = g.objects[id]!;
      const face = g.cards[o.card]?.faces[o.face];
      if (left.has(id) && !face?.abilities.some((a) => a.kind === 'triggered' && a.trigger.type === 'put_into_graveyard')) continue;
      if (face?.abilities.some((a) => a.kind === 'triggered' && a.zone === 'graveyard')) inGraveyards.push({ o, controller: o.owner, face: o.face, left: false });
    }
  }
  // CR 702.40a etc.: "When you cast this spell" — abilities that work while the spell is on the stack.
  const onStack: Candidate[] = g.stack.flatMap((s) => {
    const o = s.kind === 'spell' ? g.objects[s.object] : undefined;
    return o && !o.spellCopy ? [{ o, controller: s.controller, face: o.face, left: false }] : [];
  });
  const candidates = [...present, ...left.values(), ...inGraveyards, ...onStack];

  // Each candidate's triggered abilities: printed and from keywords (granted ones too, while it's on the battlefield).
  const withAbilities = candidates.flatMap((c) => {
    // CR 603.10a: a copy that left had the copied abilities (CR 707.2).
    const last = c.left ? g.lastKnown?.[c.o.id] : undefined;
    const at = c.left ? (last?.copyOf && last.zcc === c.o.zcc - 1 ? last.copyOf : { card: c.o.card, face: c.face }) : (c.o.copyOf ?? { card: c.o.card, face: c.face });
    // CR 708.2: face down, it has no abilities (bar ward from disguise or cloak).
    const leftFaceDown = c.left && last?.faceDown && last.zcc === c.o.zcc - 1;
    const face =
      !c.left && c.o.faceDown && (c.o.zone === 'battlefield' || c.o.zone === 'stack')
        ? faceOf(g, c.o)
        : leftFaceDown
          ? faceDownFace({ ...c.o, faceDown: last.faceDown })
          : g.cards[at.card]?.faces[at.face];
    if (!face) return [];
    const lastGranted = last && last.zcc === c.o.zcc - 1 ? (last.granted ?? []) : [];
    const abilities = c.left ? [...printedAbilities(face), ...lastGranted] : c.o.zone !== 'battlefield' ? printedAbilities(face) : abilitiesOf(g, c.o);
    return abilities.some((a) => a.kind === 'triggered') ? [{ ...c, face, abilities }] : [];
  });

  for (const event of batch) {
    for (const c of withAbilities) {
      const face = c.face;
      c.abilities.forEach((ability, index) => {
        if (ability.kind !== 'triggered') return;
        // Each ability triggers only from the zone it works in.
        if ((ability.zone ?? 'battlefield') !== (c.left || c.o.emblem ? 'battlefield' : c.o.zone)) return;
        if (c.left && !looksBack(ability.trigger)) return;
        if (!programRuns(ability)) return;
        if (ability.oncePerTurn && c.o.triggeredTurn?.[index] === g.turn) return;
        const infos = matchTrigger(ability.trigger, { g, event, source: c.o, controller: c.controller, sourceLeft: c.left, batch });
        if (ability.oncePerTurn && infos.length) {
          // "This ability triggers only once each turn."
          (c.o.triggeredTurn ??= {})[index] = g.turn;
          infos.splice(1);
        }
        for (const info of infos) {
          // CR 603.4: an intervening "if" must be true for it to trigger at all.
          if (ability.condition && !evalCondition(ability.condition, triggerContext(g, c.controller, c.o, info))) continue;
          // CR 603.3a: controlled by whoever controlled the source when it triggered.
          g.triggers.push({
            id: `t${g.nextId++}`,
            controller: c.controller,
            source: { id: c.o.id, zcc: c.o.zcc },
            sourceName: face.name,
            ability,
            info,
          });
        }
      });
    }
  }
}

/** CR 725.2: the monarch's two inherent triggered abilities. They have no source. */
const MONARCH_DRAW: TriggeredAbility = {
  kind: 'triggered',
  text: "At the beginning of the monarch's end step, that player draws a card.",
  trigger: { type: 'phase', step: 'end', whose: 'you' },
  effects: [{ type: 'draw', amount: 1, who: { ref: 'you' } }],
};
const MONARCH_STEAL: TriggeredAbility = {
  kind: 'triggered',
  text: "Whenever a creature deals combat damage to the monarch, its controller becomes the monarch.",
  trigger: { type: 'deals_combat_damage', subject: { ref: 'all', filter: { types: ['Creature'] } }, to: 'player' },
  effects: [{ type: 'become_monarch', who: { ref: 'you' } }],
};

/** CR 702.179d: the inherent triggered ability of a player with speed. It has no source. */
const SPEED_UP: TriggeredAbility = {
  kind: 'triggered',
  text: 'Whenever one or more opponents lose life during your turn, if your speed is less than 4, your speed increases by 1. This ability triggers only once each turn.',
  trigger: { type: 'lose_life', who: 'opponent' },
  effects: [{ type: 'increase_speed' }],
};

function collectSpeed(g: GameState, batch: GameEvent[]): void {
  const ps = g.players[g.active];
  if (!ps || ps.speed === undefined || ps.speed >= 4 || ps.speedTurn === g.turn) return;
  if (!batch.some((e) => e.type === 'life' && e.delta < 0 && e.player !== g.active)) return;
  ps.speedTurn = g.turn;
  g.triggers.push({ id: `t${g.nextId++}`, controller: g.active, source: { id: 'speed', zcc: 0 }, sourceName: 'Speed', ability: SPEED_UP, info: {} });
}

function collectMonarch(g: GameState, batch: GameEvent[]): void {
  if (!g.monarch) return;
  const push = (controller: PlayerId, ability: TriggeredAbility) =>
    // CR 725.2: controlled by the player who was the monarch (or whose creature dealt the damage).
    g.triggers.push({ id: `t${g.nextId++}`, controller, source: { id: 'monarch', zcc: 0 }, sourceName: 'The monarch', ability, info: {} });
  for (const e of batch) {
    if (e.type === 'step' && e.step === 'end' && g.active === g.monarch) push(g.monarch, MONARCH_DRAW);
    if (e.type === 'damage' && e.combat && e.to.kind === 'player' && e.to.player === g.monarch) {
      const o = g.objects[e.source];
      if (o && o.controller !== g.monarch && g.cards[o.card]?.faces[o.face]?.types.includes('Creature')) push(o.controller, MONARCH_STEAL);
    }
  }
}

function abilityOf(_g: GameState, t: PendingTrigger): TriggeredAbility {
  return t.ability;
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

  if (t.boundTargets) {
    // A delayed trigger: no new choices; it affects what its creator affected (CR 603.7c).
    g.triggers = g.triggers.filter((x) => x.id !== t.id);
    g.stack.push({
      kind: 'ability',
      id: `a${g.nextId++}`,
      source: t.source,
      sourceName: t.sourceName,
      controller: t.controller,
      text: ability.text,
      program: { specs: [], effects: ability.effects },
      targets: t.boundTargets,
      x: 0,
      trigger: t.info,
    });
    events.push({ type: 'triggered', source: t.source.id, text: ability.text, controller: t.controller });
    return;
  }
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
  const division = divisionFor(program.effects, targets, 0, (answer as { divide?: number[] }).divide);
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
    ...(division ? { division } : {}),
    trigger: t.info,
    ...(ability.condition ? { condition: ability.condition } : {}),
  });
  events.push({ type: 'triggered', source: t.source.id, text: ability.text, controller: t.controller });
  announceTargets(g.stack[g.stack.length - 1]!, events);
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

/** Records that a spell or ability on the stack targets objects ("becomes the target", e.g. ward, CR 702.21a). */
export function announceTargets(entry: StackEntry, events: GameEvent[]): void {
  const seen = new Set<string>();
  for (const t of entry.targets.flat()) {
    if (t.kind !== 'object' || seen.has(t.id)) continue;
    seen.add(t.id);
    events.push({
      type: 'became_target',
      object: t.id,
      ...(entry.kind === 'spell' ? { spell: entry.object } : { entry: entry.id }),
      controller: entry.controller,
    });
  }
}

/** The context a trigger's condition is checked in as it triggers. */
export function triggerContext(g: GameState, controller: PlayerId, source: GameObject, info: TriggerInfo): EffectContext {
  return { g, controller, source, sourceZcc: source.zcc, events: [], targets: [], x: 0, memo: {}, trigger: info };
}

/**
 * Abilities of cards in exile from their keywords: suspend's "At the beginning of your upkeep, … remove a
 * time counter" (CR 702.62a) and madness's "When this card is exiled this way, its owner may cast it"
 * (CR 702.35a).
 */
function collectExileKeywords(g: GameState, batch: GameEvent[]): void {
  for (const e of batch) {
    if (e.type === 'step' && e.step === 'upkeep') {
      for (const id of g.zones.exile) {
        const o = g.objects[id]!;
        if (!o.suspended || o.owner !== g.active || !(o.counters.time ?? 0)) continue;
        g.triggers.push({
          id: `t${g.nextId++}`,
          controller: o.owner,
          source: { id: o.id, zcc: o.zcc },
          sourceName: g.cards[o.card]!.faces[0]!.name,
          ability: { kind: 'triggered', text: 'Suspend — remove a time counter', trigger: { type: 'phase', step: 'upkeep', whose: 'you' }, effects: [{ type: 'suspend_tick' }] },
          info: {},
        });
      }
    }
    // CR 702.94a: "You may reveal this card from your hand as you draw it if it's the first card you've drawn this turn.
    // When you reveal this card this way, you may cast it by paying [cost] rather than its mana cost."
    if (e.type === 'drew' && e.nth === 1) {
      const o = g.objects[e.object];
      const face = o ? g.cards[o.card]?.faces[0] : undefined;
      if (o && o.zone === 'hand' && face?.keywords.some((k) => k.id === 'miracle' && k.cost && /^(\{[^}]+\})+$/.test(k.cost))) {
        g.triggers.push({
          id: `t${g.nextId++}`,
          controller: o.owner,
          source: { id: o.id, zcc: o.zcc },
          sourceName: face.name,
          ability: { kind: 'triggered', text: 'Miracle', trigger: { type: 'drew' }, effects: [{ type: 'miracle_cast' }] },
          info: {},
        });
        e.revealed = true;
      }
    }
    if (e.type === 'discarded' && e.madness) {
      const o = g.objects[e.object];
      if (!o || o.zone !== 'exile') continue;
      g.triggers.push({
        id: `t${g.nextId++}`,
        controller: o.owner,
        source: { id: o.id, zcc: o.zcc },
        sourceName: g.cards[o.card]!.faces[0]!.name,
        ability: { kind: 'triggered', text: 'Madness', trigger: { type: 'discarded' }, effects: [{ type: 'madness_cast' }] },
        info: {},
      });
    }
  }
}

/** CR 603.7b: delayed triggers fire the next time their moment comes, once. */
function collectDelayed(g: GameState, batch: GameEvent[]): void {
  // "this turn" ones that didn't fire are gone.
  if (g.delayed.some((d) => d.on && d.createdTurn !== g.turn)) g.delayed = g.delayed.filter((d) => !d.on || d.createdTurn === g.turn);
  for (const e of batch) {
    if (e.type === 'cast') {
      // "When you next cast an instant or sorcery spell this turn, copy that spell."
      for (const d of [...g.delayed]) {
        if (!d.on || e.player !== d.controller) continue;
        const spell = g.objects[e.object];
        if (!spell || !matchesFilter(g, spell, { ...d.on.filter, zone: 'stack' }, { controller: d.controller })) continue;
        g.delayed = g.delayed.filter((x) => x.id !== d.id);
        g.triggers.push({
          id: `t${g.nextId++}`,
          controller: d.controller,
          source: d.source,
          sourceName: d.sourceName,
          ability: { kind: 'triggered', text: d.text, trigger: { type: 'cast', who: 'you' }, effects: d.effects },
          info: { ...d.info, object: { id: spell.id, zcc: spell.zcc }, player: e.player },
          boundTargets: d.targets,
        });
      }
      continue;
    }
    if (e.type !== 'step') continue;
    for (const d of [...g.delayed]) {
      if (d.on || d.step !== e.step) continue;
      if (d.whose === 'you' && g.active !== d.controller) continue;
      // "the next end step" isn't the one it was created in; "the next turn's upkeep" is a later turn's.
      if (d.step === 'upkeep' ? g.turn <= d.createdTurn : g.turn === d.createdTurn && d.createdStep === 'end') continue;
      g.delayed = g.delayed.filter((x) => x.id !== d.id);
      g.triggers.push({
        id: `t${g.nextId++}`,
        controller: d.controller,
        source: d.source,
        sourceName: d.sourceName,
        ability: { kind: 'triggered', text: d.text, trigger: { type: 'phase', step: d.step, whose: 'each' }, effects: d.effects },
        info: d.info ?? {},
        boundTargets: d.targets,
      });
    }
  }
}
