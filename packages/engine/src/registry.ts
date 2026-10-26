import type { EffectNode, StaticAbility, TriggerNode } from '@mtg/schema';
import type {
  ChoiceAnswer,
  GameEvent,
  GameObject,
  GameState,
  ManaColor,
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
  /** Player's choice for this effect (e.g. which mana option), when it needs one. */
  choice?: number | ManaColor;
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
}

/**
 * true: done. false: couldn't be carried out automatically.
 * { ask }: stop and wait for a player's choice, then call again with ctx.answer.
 * { expand }: replace this effect with these (used by "you may").
 */
export type EffectResult = boolean | { ask: PendingChoice } | { expand: EffectNode[] };
export type EffectHandler = (node: EffectNode, ctx: EffectContext) => EffectResult;

/** A static ability that modifies how its permanent enters the battlefield (CR 614.12). */
export type EnterReplacement = (node: EffectNode, o: GameObject, g: GameState) => void;

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

export function hasEffectHandler(type: string): boolean {
  return effects.has(type);
}

export function hasTriggerMatcher(type: string): boolean {
  return triggers.has(type);
}

export function hasStaticHandler(type: string): boolean {
  return statics.has(type);
}

export function runEffect(node: EffectNode, ctx: EffectContext): EffectResult {
  const handler = effects.get(node.type);
  return handler ? handler(node, ctx) : false;
}

export function matchTrigger(trigger: TriggerNode, check: TriggerCheck): TriggerInfo[] {
  const m = triggers.get(trigger.type);
  return m ? m(trigger, check) : [];
}

/** True when the engine can run every effect of an ability on its own. */
export function canAutomate(ability: { effects: EffectNode[] }): boolean {
  return ability.effects.every((e) => effects.has(e.type));
}

export function onEnterBattlefield(g: GameState, o: GameObject, _events: GameEvent[]): void {
  const def = g.cards[o.card];
  const face = def?.faces[o.face] ?? def?.faces[0];
  for (const ability of face?.abilities ?? []) {
    if (ability.kind !== 'static') continue;
    const replacement = enterReplacements.get((ability as StaticAbility).effect.type);
    if (replacement) replacement((ability as StaticAbility).effect, o, g);
  }
}
