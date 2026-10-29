import { copyChoicePending } from './as-enters.js';
import type { Amount, ConditionNode, KeywordInstance, TargetSpec, TriggeredAbility, TriggerExtraNode, TriggerNode } from '@mtg/schema';
import { abilitiesOf, chars, matchesFilter, objectAbilities, printedAbilities, withCharsCache } from './characteristics.js';
import { evalCondition, loggedUpTo, logTurnEvents } from './conditions.js';
import type { EffectContext } from './registry.js';
import { flatten, programRuns, recordModes, usedModes } from './program.js';
import { matchTrigger } from './registry.js';
import { amountOf, apnap } from './resolve.js';
import { chooseTargets, dividedCap, divisionFor, targetCandidates, targetPrompts, relatedPick, targetsRequired, withTriggerInfo } from './targets.js';
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
import { ringAbilities } from './ring.js';
import { collectDungeonTriggers } from './dungeons.js';

/**
 * Triggered abilities (CR 603). Events are checked in batches: after each action,
 * after each round of state-based actions, and before anyone gets priority.
 * CR 603.2: an ability triggers when an event matches its trigger condition.
 * CR 603.3: it's put on the stack the next time a player would receive priority.
 */

const TRIGGER_EVENTS = new Set<GameEvent['type']>([
  'moved', 'created', 'attacks_declared', 'blocks_declared', 'damage', 'step', 'cast', 'life', 'drew', 'became_target', 'counters',
  'class_level', 'turned_face_up', 'discarded', 'day_night', 'tapped', 'ability_activated', 'exerted', 'clashed',
  'sacrificed', 'blockers_done', 'scried', 'surveilled', 'foraged', 'copied', 'became_monstrous', 'ring_tempted',
  'room_entered', 'dungeon_completed', 'initiative', 'crime', 'transformed', 'unlocked', 'die_rolled', 'land_played', 'searched', 'countered', 'proliferated', 'coin_flip',
  'prevented', 'player_counters', 'milled',
]);
/** CR 603.6c: sacrificing is leaving the battlefield — "When you sacrifice ~" looks back too. */
const LOOK_BACK = new Set(['dies', 'leaves', 'sacrificed']);
/** CR 603.10a: leaves-the-battlefield abilities "look back in time" ("When ~ enters or dies" too). */
const looksBack = (t: TriggerNode): boolean => LOOK_BACK.has(t.type) || (t.type === 'either' && ((t.of as TriggerNode[] | undefined) ?? []).some(looksBack));

const cursors = loggedUpTo;

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
  collectTurnTriggers(g, batch);
  collectMonarch(g, batch);
  collectRadiation(g, batch);
  collectSpeed(g, batch);
  collectDungeonTriggers(g, batch);
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
  const extras = triggerExtras(g, [...left.values()]);

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
    // Maelstrom Nexus: a spell given cascade ("The first spell you cast each turn has cascade") has its trigger as it's cast.
    // (Each instance triggers, CR 702.85c: a spell with cascade that's given cascade has two.)
    const grantedOnStack = c.o.zone === 'stack' && !c.left ? grantedKeywords(chars(g, c.o).keywords, face.keywords).flatMap((k) => (k.abilities ?? []).filter((a) => a.kind === 'triggered')) : [];
    const abilities = c.left ? [...printedAbilities(face), ...lastGranted] : c.o.zone !== 'battlefield' ? [...printedAbilities(face), ...grantedOnStack] : [...abilitiesOf(g, c.o), ...ringAbilities(g, c.o)];
    return abilities.some((a) => a.kind === 'triggered') ? [{ ...c, face, abilities }] : [];
  });

  for (const event of batch) {
    for (const c of withAbilities) {
      const face = c.face;
      c.abilities.forEach((ability, index) => {
        if (ability.kind !== 'triggered') return;
        // Each ability triggers only from the zone it works in. Cityscape Leveler: "When you cast this spell and whenever this
        // creature attacks" — from the stack too.
        const here = c.left || c.o.emblem ? 'battlefield' : c.o.zone;
        const castSelf = here === 'stack' && ability.trigger.type === 'either' && (ability.trigger.of as TriggerNode[]).some((t) => t.type === 'cast' && t.self);
        if ((ability.zone ?? 'battlefield') !== here && !castSelf) return;
        if (c.left && !looksBack(ability.trigger)) return;
        if (!programRuns(ability)) return;
        if (ability.oncePerTurn && c.o.triggeredTurn?.[index] === g.turn) return;
        // CR 603.2h: "Do this only once each turn." — not once its controller took that action this turn.
        if (ability.doOnce && c.o.doneOnce?.[`${c.o.zcc}:${ability.text}`] === g.turn) return;
        // CR 603.4: an intervening "if" must be true for it to trigger at all.
        // "Whenever ~ attacks while you control a creature with power 4 or greater": part of the trigger condition, checked
        // as the event happens only (unlike an intervening "if", it isn't checked again as it resolves).
        const during = ability.trigger.while as ConditionNode | undefined;
        const infos = matchTrigger(ability.trigger, { g, event, source: c.o, controller: c.controller, sourceLeft: c.left, batch }).filter(
          (info) =>
            (!during || evalCondition(during, triggerContext(g, c.controller, c.o, info, ability))) &&
            (!ability.condition || evalCondition(ability.condition, triggerContext(g, c.controller, c.o, info, ability))),
        );
        if (ability.oncePerTurn && infos.length) {
          // "This ability triggers only once each turn." — once it has triggered (Tataru Taru: not an opponent's draw
          // on their own turn).
          (c.o.triggeredTurn ??= {})[index] = g.turn;
          infos.splice(1);
        }
        for (const info of infos) {
          // CR 603.2d: Panharmonicon & co. — it may trigger additional times (or, under Torpor Orb, not at all).
          const times = extras.length && !info.state ? triggerTimes(g, extras, event, info, c) : 1;
          // CR 603.3a: controlled by whoever controlled the source when it triggered.
          // CR 400.7: Liliana, Heretical Healer dying with another creature — "exile Liliana" can't find the new object in
          // her owner's graveyard (an ability triggering on her own leaving can, CR 603.10a).
          const excludesSelf = (ability.trigger as { subject?: { filter?: { other?: boolean } } }).subject?.filter?.other === true;
          const zcc = c.left && excludesSelf ? (g.lastKnown?.[c.o.id]?.zcc ?? c.o.zcc) : c.o.zcc;
          for (let k = 0; k < times; k++) {
            g.triggers.push({
              id: `t${g.nextId++}`,
              controller: c.controller,
              source: { id: c.o.id, zcc },
              sourceName: face.name,
              ability,
              info,
            });
          }
        }
      });
    }
  }
}

interface TriggerExtra {
  node: TriggerExtraNode;
  source: GameObject;
  controller: PlayerId;
  /** It left the battlefield in this batch (Teysa Karlov dying with other creatures still applies, CR 603.10a). */
  left: boolean;
}

/** The statics that change how many times abilities trigger (CR 603.2d). */
function triggerExtras(g: GameState, left: Candidate[]): TriggerExtra[] {
  const out: TriggerExtra[] = [];
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    if (source.zone !== 'battlefield') continue;
    for (const a of objectAbilities(g, source)) {
      if (a.kind === 'static' && a.effect.type === 'trigger_extra') out.push({ node: a.effect as unknown as TriggerExtraNode, source, controller: source.controller, left: false });
    }
  }
  for (const c of left) {
    const face = g.cards[c.o.card]?.faces[c.face];
    if (!face || c.o.faceDown) continue;
    for (const a of printedAbilities(face)) {
      if (a.kind !== 'static' || a.effect.type !== 'trigger_extra') continue;
      const node = a.effect as unknown as TriggerExtraNode;
      // Only an effect about leaving (dying) can apply to the event that took its own source away.
      if (['dies', 'leaves', 'enters_or_leaves', 'enters_or_dies'].includes(node.cause?.event ?? '')) out.push({ node, source: c.o, controller: c.controller, left: true });
    }
  }
  return out;
}

/** Whether the event that triggered an ability is the one an effect names ("an artifact or creature entering"). */
function causedBy(g: GameState, cause: NonNullable<TriggerExtraNode['cause']>, event: GameEvent, info: TriggerInfo, x: TriggerExtra): boolean {
  const ctx = { controller: x.controller, source: x.source };
  const fits = (id: ObjectId | undefined, extra: { anyZone?: boolean; lastController?: PlayerId } = {}) => {
    const o = id ? g.objects[id] : undefined;
    return Boolean(o && (!cause.filter || matchesFilter(g, o, cause.filter, { ...ctx, ...extra })));
  };
  const entering = event.type === 'created' || (event.type === 'moved' && event.to === 'battlefield');
  const leaving = event.type === 'moved' && event.from === 'battlefield';
  switch (cause.event) {
    case 'enters':
      return entering && fits(event.object);
    case 'leaves':
      return leaving && fits(event.object, { anyZone: true, lastController: event.controller });
    case 'enters_or_leaves':
      return entering ? fits((event as { object: ObjectId }).object) : leaving && fits(event.object, { anyZone: true, lastController: event.controller });
    case 'dies':
      return leaving && event.to === 'graveyard' && fits(event.object, { anyZone: true, lastController: event.controller });
    case 'enters_or_dies':
      return entering ? fits((event as { object: ObjectId }).object) : leaving && event.to === 'graveyard' && fits(event.object, { anyZone: true, lastController: event.controller });
    case 'attacks':
      if (event.type !== 'attacks_declared') return false;
      // "Whenever you attack" names no attacker: any of them attacking caused it.
      return info.object && event.attacks.some((a) => a.attacker === info.object!.id) ? fits(info.object.id) : event.attacks.some((a) => fits(a.attacker));
    case 'cast_copy': {
      // Veyran: "you casting or copying an instant or sorcery spell"
      if (event.type === 'cast') return event.player === x.controller && fits(event.object, { anyZone: true });
      if (event.type === 'copied') return event.controller === x.controller && fits(event.object, { anyZone: true });
      return false;
    }
    case 'draw':
      return event.type === 'drew';
    case 'gain_life':
      return event.type === 'life' && event.delta > 0 && event.player === x.controller;
    case 'combat_damage_player':
      return event.type === 'damage' && event.combat && event.to.kind === 'player' && fits(event.source, { anyZone: true });
    default:
      return false;
  }
}

/** CR 603.2d: how many times an ability triggers — once, plus one for each effect that adds a time; none under Torpor Orb. */
function triggerTimes(g: GameState, extras: TriggerExtra[], event: GameEvent, info: TriggerInfo, c: { o: GameObject; controller: PlayerId; left: boolean }): number {
  let n = 1;
  for (const x of extras) {
    const node = x.node;
    // "of a permanent you control": not a card in a graveyard, a spell, or an emblem.
    if (node.permanent && (c.o.emblem || !(c.left || c.o.zone === 'battlefield'))) continue;
    if (node.sourceAttached) {
      // Wizard's Staff: "If a triggered ability of equipped creature triggers"
      const at = x.source.attachedTo;
      if (!at || at.id !== c.o.id) continue;
    }
    if (node.source && !matchesFilter(g, c.o, node.source, { controller: x.controller, source: x.source, ...(c.left ? { anyZone: true, lastController: c.controller } : {}) })) continue;
    if (node.cause && !causedBy(g, node.cause, event, info, x)) continue;
    if (node.none) return 0;
    n++;
  }
  return n;
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

/**
 * CR 728.1: the inherent triggered ability of rad counters. It has no source and is controlled by the active player:
 * "At the beginning of each player's precombat main phase, if that player has one or more rad counters, that player mills a
 * number of cards equal to the number of rad counters they have. For each nonland card milled this way, that player loses
 * 1 life and removes one rad counter from themselves."
 */
const RADIATION: TriggeredAbility = {
  kind: 'triggered',
  text: "At the beginning of each player's precombat main phase, if that player has one or more rad counters, that player mills a number of cards equal to the number of rad counters they have. For each nonland card milled this way, that player loses 1 life and removes one rad counter from themselves.",
  trigger: { type: 'phase', step: 'main1', whose: 'you' },
  effects: [{ type: 'radiation' }],
};

function collectRadiation(g: GameState, batch: GameEvent[]): void {
  // CR 603.4: the intervening "if" — checked again as it resolves (the effect then does nothing without rad counters).
  if (!batch.some((e) => e.type === 'step' && e.step === 'main1') || !(g.players[g.active]?.counters?.rad ?? 0)) return;
  g.triggers.push({ id: `t${g.nextId++}`, controller: g.active, source: { id: 'radiation', zcc: 0 }, sourceName: 'Rad counters', ability: RADIATION, info: {} });
}

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
  // Scrap Trawler: targets counted from the event ("with lesser mana value" than the artifact that died).
  withTriggerInfo(t.info, () => putOnStackNow(g, t, events, answer));
}

function putOnStackNow(g: GameState, t: PendingTrigger, events: GameEvent[], answer?: { modes?: number[]; targets: Target[][] }): void {
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
    // "Choose one that hasn't been chosen this turn": with every mode chosen already, none can be (CR 700.2b).
    const used = usedModes(g, t.source, ability);
    if (ability.modes && used.length && ability.modes.options.every((_, i) => used.includes(i))) {
      g.triggers = g.triggers.filter((x) => x !== t);
      return;
    }
    const candidates = specs.map((s) => targetCandidates(g, t.controller, s, source));
    // CR 603.3d (via CR 601.2c): with too few legal targets the ability is removed from the stack.
    // "from a single graveyard": what one graveyard has.
    const available = (s: TargetSpec, c: Target[]) => {
      // Run Away Together, Secret Tunnel: how many of them can be chosen together.
      if (s.distinctManaValues || s.differentControllers || s.shareCreatureType || s.shareCardType || s.maxTotalMV !== undefined) return relatedPick(g, s, c, c.length).length;
      if (!s.sameOwner) return c.length;
      const by = new Map<string | undefined, number>();
      for (const x of c) {
        const owner = x.kind === 'object' ? g.objects[x.object]?.owner : undefined;
        by.set(owner, (by.get(owner) ?? 0) + 1);
      }
      return Math.max(0, ...by.values());
    };
    if (!modal && specs.some((s, i) => available(s, candidates[i]!) < targetsRequired(g, t.controller, s, candidates[i]!))) {
      g.triggers = g.triggers.filter((x) => x !== t);
      return;
    }
    // Only one legal choice: made automatically ("from a single graveyard" can still leave a choice).
    const forced = !modal && specs.every((s, i) => (s.upTo ? candidates[i]!.length === 0 : !s.perPlayer && !s.sameOwner && !s.differentControllers && !s.shareCreatureType && !s.shareCardType && !s.distinctManaValues && s.maxTotalMV === undefined && candidates[i]!.length === (s.count ?? 1)));
    if (!forced) {
      const prompts = targetPrompts(g, t.controller, specs, source);
      // "X damage divided as you choose among any number of targets, where X is …": no more targets than X.
      const cap = modal ? null : dividedCap(ability.effects, 0, (a) => amountOf({ g, controller: t.controller, source: source ?? undefined, events: [], targets: [], x: 0, memo: {}, trigger: t.info } as EffectContext, a as Amount));
      // With nothing to divide no target can be chosen, so it's removed like one without legal targets (CR 603.3d).
      if (cap && cap.total <= 0 && (specs[cap.index]?.min ?? 1) > 0) {
        g.triggers = g.triggers.filter((x) => x !== t);
        return;
      }
      if (cap && prompts[cap.index]) prompts[cap.index] = { ...prompts[cap.index]!, count: Math.min(prompts[cap.index]!.count, cap.total) };
      g.pending = {
        kind: 'trigger_targets',
        player: t.controller,
        trigger: t.id,
        sourceName: t.sourceName,
        text: ability.text,
        prompts,
        ...(ability.modes
          ? {
              modes: {
                min: ability.modes.min,
                max: ability.modes.max,
                ...(ability.modes.repeat ? { repeat: true as const } : {}),
                ...(used.length ? { used } : {}),
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
  recordModes(g, t.source, ability, answer.modes);
  const division = divisionFor(program.effects, targets, 0, (answer as { divide?: number[] }).divide, (a) =>
    amountOf({ g, controller: t.controller, source: source ?? undefined, events: [], targets, x: 0, memo: {}, trigger: t.info } as EffectContext, a as Amount),
  );
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
    x: entersX(ability, source, t.info, g),
    ...(division ? { division } : {}),
    trigger: t.info,
    ...(ability.condition ? { condition: ability.condition } : {}),
  });
  events.push({ type: 'triggered', source: t.source.id, text: ability.text, controller: t.controller });
  announceTargets(g.stack[g.stack.length - 1]!, events, g);
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
      const used = usedModes(g, t.source, ability);
      const anyLegal = ability.modes.options.some((m, i) =>
        !used.includes(i) && (m.targets ?? []).every((s) => {
          const c = targetCandidates(g, t.controller, s, g.objects[t.source.id] ?? null);
          return c.length >= targetsRequired(g, t.controller, s, c);
        }),
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
export function announceTargets(entry: StackEntry, events: GameEvent[], g?: GameState): void {
  // CR 700.13: targeting an opponent, something an opponent controls, or a card in an opponent's graveyard is a crime.
  if (g) {
    const me = entry.controller;
    const crime = entry.targets.flat().some((t) => {
      if (t.kind === 'player') return t.player !== me;
      if (t.kind === 'ability') {
        const other = g.stack.find((s) => s.kind === 'ability' && s.id === t.entry);
        return Boolean(other && other.controller !== me);
      }
      const o = g.objects[t.id];
      if (!o) return false;
      if (o.zone === 'battlefield' || o.zone === 'stack') return o.controller !== me;
      return o.zone === 'graveyard' && o.owner !== me;
    });
    if (crime) events.push({ type: 'crime', player: me });
  }
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
export function triggerContext(g: GameState, controller: PlayerId, source: GameObject, info: TriggerInfo, ability?: TriggeredAbility): EffectContext {
  return { g, controller, source, sourceZcc: source.zcc, events: [], targets: [], x: ability ? entersX(ability, source, info, g) : 0, memo: {}, trigger: info };
}

/**
 * CR 107.3m: an object's own enters-the-battlefield trigger uses the X its spell was cast with; CR 107.3i: so does its own
 * "When you cast this spell" trigger (Hydroid Krasis), with the spell on the stack.
 */
function entersX(ability: TriggeredAbility, source: GameObject | null, info: TriggerInfo, g?: GameState): number {
  if (source && ability.trigger.type === 'enters' && info.object?.id === source.id) return source.x ?? 0;
  if (source && g && ability.trigger.type === 'cast' && (ability.trigger as { self?: boolean }).self && source.zone === 'stack') {
    const entry = g.stack.find((e) => e.kind === 'spell' && e.object === source.id);
    return entry?.x ?? 0;
  }
  // Shark Typhoon: "When you cycle this card" — the X paid for that cycling ability.
  if (g && ability.trigger.type === 'activate' && (ability.trigger as { self?: boolean }).self && info.entry) {
    const entry = g.stack.find((e) => e.kind === 'ability' && e.id === info.entry);
    return entry?.x ?? 0;
  }
  return 0;
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
        // CR 702.62b: suspended — in exile, with suspend, and with a time counter (Rousing Refrain exiles itself so).
        const suspend = o.suspended || g.cards[o.card]?.faces[0]?.keywords.some((k) => k.id === 'suspend');
        if (!suspend || o.owner !== g.active || !(o.counters.time ?? 0)) continue;
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
/** CR 603.7: "this turn" triggered abilities created by resolved spells and abilities. */
function collectTurnTriggers(g: GameState, batch: GameEvent[]): void {
  if (!g.turnTriggers?.length) return;
  if (g.turnTriggers.some((t) => t.turn !== g.turn)) g.turnTriggers = g.turnTriggers.filter((t) => t.turn === g.turn);
  for (const event of batch) {
    for (const t of g.turnTriggers ?? []) {
      const source = g.objects[t.source.id];
      if (!source || !programRuns(t.ability)) continue;
      const infos = matchTrigger(t.ability.trigger, { g, event, source, controller: t.controller, sourceLeft: false, batch, ...(t.targets ? { targets: t.targets } : {}) });
      for (const info of infos) {
        if (t.ability.condition && !evalCondition(t.ability.condition, { ...triggerContext(g, t.controller, source, info, t.ability), ...(t.targets ? { targets: t.targets } : {}) })) continue;
        g.triggers.push({ id: `t${g.nextId++}`, controller: t.controller, source: t.source, sourceName: t.sourceName, ability: t.ability, info, ...(t.targets ? { boundTargets: t.targets } : {}) });
      }
    }
  }
}

function collectDelayed(g: GameState, batch: GameEvent[]): void {
  // "this turn" ones that didn't fire are gone.
  if (g.delayed.some((d) => d.on && d.createdTurn !== g.turn)) g.delayed = g.delayed.filter((d) => !d.on || d.createdTurn === g.turn);
  for (const e of batch) {
    // Earthbend: "When that land dies or is put into exile" — once, as that permanent leaves for one of those zones; it's
    // gone for good if it leaves for anywhere else (CR 400.7).
    if (e.type === 'moved' && e.from === 'battlefield' && g.delayed.some((d) => d.leaves?.id === e.object)) {
      const o = g.objects[e.object];
      for (const d of [...g.delayed]) {
        // A token that left has ceased to exist (CR 111.7) — it still left.
        if (d.leaves?.id !== e.object || (o ? o.zcc !== d.leaves.zcc + 1 : !d.leavesAnyZone)) continue;
        g.delayed = g.delayed.filter((x) => x.id !== d.id);
        if (!d.leavesAnyZone && e.to !== 'graveyard' && e.to !== 'exile') continue;
        g.triggers.push({
          id: `t${g.nextId++}`,
          controller: d.controller,
          source: d.source,
          sourceName: d.sourceName,
          ability: { kind: 'triggered', text: d.text, trigger: { type: 'leaves', subject: { ref: 'self' } }, effects: d.effects },
          info: { ...d.info, object: { id: e.object, zcc: o ? o.zcc : d.leaves.zcc + 1 } },
          boundTargets: [],
        });
      }
      continue;
    }
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
      // "your next main phase": precombat or postcombat (CR 505.1).
      const isMain = e.step === 'main1' || e.step === 'main2';
      if (d.on || d.leaves || !(d.step === e.step || (d.step === 'main' && isMain))) continue;
      if (d.whose === 'you' && g.active !== d.controller) continue;
      // "the next end step" isn't the one it was created in; "the next turn's upkeep" is a later turn's.
      if (d.step === 'upkeep' ? g.turn <= d.createdTurn : g.turn === d.createdTurn && d.createdStep === e.step) continue;
      if (d.laterTurn && g.turn <= d.createdTurn) continue;
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

/** The keywords in `all` beyond the printed ones (one printed instance accounts for one of the same id). */
function grantedKeywords(all: readonly KeywordInstance[], printed: readonly KeywordInstance[]): KeywordInstance[] {
  const left = new Map<string, number>();
  for (const k of printed) left.set(k.id, (left.get(k.id) ?? 0) + 1);
  return all.filter((k) => {
    const n = left.get(k.id) ?? 0;
    if (n > 0) {
      left.set(k.id, n - 1);
      return false;
    }
    return true;
  });
}
