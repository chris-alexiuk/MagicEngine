import type { EffectNode, TriggerNode } from '@mtg/schema';
import { replaced, type Also, type Enter } from './instead.js';
import { ENTER_RULES, untappedIfItCan } from './instead-enters.js';
import { replaceQuantity } from './quantities.js';
import type {
  ChoiceAnswer,
  GameEvent,
  GameObject,
  GameState,
  ManaColor,
  ManaMix,
  PendingChoice,
  PlayerId,
  Resolution,
  TargetRef,
  TriggerInfo,
} from './types.js';

/**
 * Mechanic registries. The compiler emits AST nodes with string tags; the engine
 * looks those tags up here. A mechanic plugin registers its handlers at import
 * time. Unknown tags fall back to manual resolution, never to a crash.
 */

export interface EffectContext {
  g: GameState;
  controller: PlayerId;
  /** The spell, or the permanent whose ability this is. May have left its zone since. */
  source?: GameObject;
  /** Zone-change count of the source when the ability was put on the stack ("~" means that object only). */
  sourceZcc?: number;
  /** Farrelite Priest: a mana ability's key for "if this ability has been activated four or more times this turn". */
  manaAbilityKey?: string;
  /** Player's choice for this effect (e.g. which mana option), when it needs one. */
  choice?: number | ManaColor | ManaMix;
  events: GameEvent[];
  /** Legal targets, one list per target spec. */
  targets: TargetRef[][];
  x: number;
  trigger?: TriggerInfo;
  /** The answer to the choice this effect asked for, when resuming. */
  answer?: ChoiceAnswer;
  /** Scratch space that survives between asking and resuming. */
  memo: Record<string, unknown>;
  resolution?: Resolution;
  /** A static ability's amount counted for one object it applies to (Ref 'affected', Coat of Arms). */
  affected?: GameObject;
  /** An amount counted for one of the players an effect is for (Ref 'each_player', Archfiend of Despair). */
  eachPlayer?: PlayerId;
}

/**
 * true: done. false: couldn't be carried out automatically.
 * { ask }: stop and wait for a player's choice, then call again with ctx.answer.
 * { expand }: replace this effect with these (used by "you may").
 */
export type EffectResult = boolean | { ask: PendingChoice } | { expand: EffectNode[] };
export type EffectHandler = (node: EffectNode, ctx: EffectContext) => EffectResult;

/** What a replacement effect makes of how a permanent enters: tapped or not, counters it enters with, and what else is done as it does. */
export interface EnterChange {
  tapped?: boolean;
  counters?: Record<string, number>;
  also?: Also[];
}

/**
 * A static ability that modifies how its permanent enters the battlefield (CR 614.12): what it makes of that, or null
 * if it doesn't apply. It changes nothing itself — the entering is put together from all the effects on it
 * (instead-enters.ts), and then takes place.
 */
export type EnterReplacement = (node: EffectNode, o: GameObject, g: GameState) => EnterChange | null;

/** Everything a trigger matcher may look at for one event (CR 603.2). */
export interface TriggerCheck {
  g: GameState;
  event: GameEvent;
  /** The permanent (or, for leaves-the-battlefield triggers, the object that just left) whose ability it is. */
  source: GameObject;
  /** Who controlled the source when the event happened. */
  controller: PlayerId;
  /** CR 603.10a: the source left the battlefield in this same event batch. */
  sourceLeft: boolean;
  /** Every event in the batch, for triggers that add up simultaneous events ("deals damage"). */
  batch?: GameEvent[];
  /** A "this turn" ability's creator's targets ("Whenever that creature deals combat damage … this turn"). */
  targets?: TargetRef[][];
}

/**
 * Returns one entry per time the ability triggers on this event (CR 603.2c: an event with
 * several occurrences, like several attackers, can trigger it several times).
 */
export type TriggerMatcher = (trigger: TriggerNode, check: TriggerCheck) => TriggerInfo[];

export interface MechanicPlugin {
  id: string;
  effects?: Record<string, EffectHandler>;
  enterReplacements?: Record<string, EnterReplacement>;
  triggers?: Record<string, TriggerMatcher>;
  /** Static ability tags this plugin understands (applied elsewhere, e.g. in characteristics). */
  statics?: string[];
}

const effects = new Map<string, EffectHandler>();
const enterReplacements = new Map<string, EnterReplacement>();
const triggers = new Map<string, TriggerMatcher>();
const statics = new Set<string>();
const plugins: string[] = [];

export function installPlugin(plugin: MechanicPlugin): void {
  if (plugins.includes(plugin.id)) return;
  plugins.push(plugin.id);
  for (const [type, h] of Object.entries(plugin.effects ?? {})) effects.set(type, h);
  for (const [type, h] of Object.entries(plugin.enterReplacements ?? {})) {
    enterReplacements.set(type, h);
    statics.add(type);
  }
  for (const [type, h] of Object.entries(plugin.triggers ?? {})) triggers.set(type, h);
  for (const type of plugin.statics ?? []) statics.add(type);
}

export function installedPlugins(): readonly string[] {
  return plugins;
}

/**
 * A name looked up in one of the tables above and not found there: told to whoever is listening. The card checks are
 * (scripts/lib/impact.ts) — a handler added under that name later changes what this lookup gives, so the cards whose
 * play came by here are the ones to play again. Nobody listens in a game.
 */
function found<T>(table: 'effects' | 'triggers' | 'enterReplacements' | 'statics', type: string, value: T): T {
  if (value === undefined || value === false) (globalThis as { __miss?: (key: string) => void }).__miss?.(`${table}:${type}`);
  return value;
}

export function hasEffectHandler(type: string): boolean {
  return found('effects', type, effects.has(type));
}

export function hasTriggerMatcher(type: string): boolean {
  return found('triggers', type, triggers.has(type));
}

export function hasStaticHandler(type: string): boolean {
  return found('statics', type, statics.has(type));
}

export function runEffect(node: EffectNode, ctx: EffectContext): EffectResult {
  const handler = found('effects', node.type, effects.get(node.type));
  return handler ? handler(node, ctx) : false;
}

export function matchTrigger(trigger: TriggerNode, check: TriggerCheck): TriggerInfo[] {
  const m = found('triggers', trigger.type, triggers.get(trigger.type));
  return m ? m(trigger, check) : [];
}

/** True when the engine can run every effect of an ability on its own. */
export function canAutomate(ability: { effects: EffectNode[] }): boolean {
  return ability.effects.every((e) => found('effects', e.type, effects.has(e.type)));
}

export function onEnterBattlefield(g: GameState, o: GameObject, events: GameEvent[]): void {
  // CR 122.6: counters it enters with are "put on" it too — "Whenever one or more +1/+1 counters are put on …" sees them.
  const before = { ...o.counters };
  applyEnterReplacements(g, o, events);
  for (const [counter, n] of Object.entries(o.counters)) {
    const delta = n - (before[counter] ?? 0);
    if (delta > 0) events.push({ type: 'counters', object: o.id, counter, delta, by: o.controller });
  }
  // A creature or planeswalker with a line the engine couldn't read: if that line is what gives it its size or loyalty,
  // its controller is asked for it — after the card's own choices (as-enters.ts: it may enter as a copy of something).
  if (!o.faceDown) {
    const at = o.copyOf ?? o;
    const face = g.cards[at.card]?.faces[at.face] ?? g.cards[at.card]?.faces[0];
    const unread = Boolean(face && (face.unparsed.length || face.manualKeywords?.length));
    const choice = !face || !unread ? null : face.types.includes('Creature') ? ('size' as const) : face.types.includes('Planeswalker') ? ('loyalty' as const) : null;
    if (choice) {
      o.unsized = true;
      (g.asEnters ??= []).push({ object: o.id, zcc: o.zcc, node: { type: 'as_enters', choice } });
    }
  }
}

/** The handler registered for a static ability that says how its permanent enters, if there is one. */
export function enterReplacementFor(type: string): EnterReplacement | undefined {
  return found('enterReplacements', type, enterReplacements.get(type));
}

/**
 * CR 614.12: how the permanent enters, as the replacement effects on that leave it — tapped or not, with which
 * counters, and what else they do as it enters (a choice to ask for, a type it has from now on).
 */
function applyEnterReplacements(g: GameState, o: GameObject, events: GameEvent[]): void {
  // CR 708.3: a permanent that enters face down has no abilities as it enters.
  if (o.faceDown) return;
  const asked: Enter = { kind: 'enter', object: o, tapped: o.tapped, counters: {}, also: [] };
  // (Which effects apply doesn't hang on what the others make of it: they are found once.)
  const found = Object.values(ENTER_RULES).flatMap((rule) => rule(g, asked));
  const enter = found.length ? (replaced(g, asked, { found: () => found }, { prefer: untappedIfItCan }) ?? asked) : asked;
  for (const more of enter.also) if (more.early) more.run(g, o, events);
  o.tapped = enter.tapped;
  // CR 122.6: counters it enters with are put on it — all of a kind at once, so counter replacements apply to the lot.
  for (const [counter, base] of Object.entries(enter.counters)) {
    const n = replaceQuantity(g, 'counters', base, { player: o.controller, object: o, counter });
    if (n > 0) o.counters[counter] = (o.counters[counter] ?? 0) + n;
  }
  for (const more of enter.also) if (!more.early) more.run(g, o, events);
}
