import type { AmountExpr, ConditionNode, EffectNode, ObjectFilter, StaticAbility, TriggerNode } from '@mtg/schema';
import { chars, matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import { replaceQuantity } from './quantities.js';
import { amountOf } from './resolve.js';
import { abilitySources } from './zones.js';
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

/** A static ability that modifies how its permanent enters the battlefield (CR 614.12). */
export type EnterReplacement = (node: EffectNode, o: GameObject, g: GameState, events?: GameEvent[]) => void;

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

export function onEnterBattlefield(g: GameState, o: GameObject, events: GameEvent[]): void {
  // CR 122.6: counters it enters with are "put on" it too — "Whenever one or more +1/+1 counters are put on …" sees them.
  const before = { ...o.counters };
  applyEnterReplacements(g, o, events);
  for (const [counter, n] of Object.entries(o.counters)) {
    const delta = n - (before[counter] ?? 0);
    if (delta > 0) events.push({ type: 'counters', object: o.id, counter, delta, by: o.controller });
  }
}

function applyEnterReplacements(g: GameState, o: GameObject, events: GameEvent[]): void {
  // CR 708.3: a permanent that enters face down has no abilities as it enters.
  if (o.faceDown) return;
  const at = o.copyOf ?? o;
  const def = g.cards[at.card];
  const face = def?.faces[at.face] ?? def?.faces[0];
  const abilities = face ? [...face.abilities, ...face.keywords.flatMap((k) => k.abilities ?? [])] : [];
  for (const ability of abilities) {
    if (ability.kind !== 'static') continue;
    const replacement = enterReplacements.get((ability as StaticAbility).effect.type);
    if (replacement) replacement((ability as StaticAbility).effect, o, g, events);
  }
  // CR 614.12: a keyword another permanent gives it ("Nontoken creatures you control have riot") applies as it enters.
  const printed = new Set(face?.keywords.map((k) => k.id) ?? []);
  for (const k of chars(g, o).keywords) {
    if (printed.has(k.id)) continue;
    for (const a of k.abilities ?? []) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'as_enters') continue;
      enterReplacements.get('as_enters')?.((a as StaticAbility).effect, o, g);
    }
  }
  // CR 614.1d: "Creatures your opponents control enter tapped." — another permanent's replacement effect.
  for (const id of abilitySources(g)) {
    if (id === o.id) continue;
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield') continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static') continue;
      const effect = (a as StaticAbility).effect;
      if (effect.type !== 'enter_tapped_others' && effect.type !== 'enter_counters_others') continue;
      if (!staticConditionHolds(g, effect as { condition?: ConditionNode }, src)) continue;
      const filter = (effect.filter ?? {}) as ObjectFilter;
      if (!matchesFilter(g, o, filter, { controller: src.controller, source: src, anyZone: true })) continue;
      if (effect.type === 'enter_tapped_others') o.tapped = true;
      else {
        // Metallic Mimic: "Each other creature you control of the chosen type enters with an additional +1/+1 counter on
        // it." — counters it enters with are put on it (CR 122.6), so counter replacements apply.
        const counter = String(effect.counter);
        // Giada: "for each Angel you already control" — not counting the one entering; Arwen: "equal to Arwen's toughness".
        let base = Number(effect.amount ?? 1);
        if (effect.amount && typeof effect.amount === 'object') {
          const a = effect.amount as AmountExpr;
          const counted = effect.notEntering && a.kind === 'count' ? { ...a, filter: { ...a.filter, notObject: o.id } } : a;
          base = Math.max(0, amountOf({ g, controller: src.controller, source: src, events: [], targets: [], x: 0, memo: {} }, counted));
        }
        const n = replaceQuantity(g, 'counters', base, { player: o.controller, object: o, counter });
        if (n > 0) o.counters[counter] = (o.counters[counter] ?? 0) + n;
      }
    }
  }
  // Spelunking: "Lands you control enter untapped." — even one that would enter tapped: its controller orders the
  // replacement effects (CR 616.1), so this one applies last.
  for (const id of abilitySources(g)) {
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield' || src.controller !== o.controller) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'enter_untapped_others') continue;
      const effect = (a as StaticAbility).effect;
      if (staticConditionHolds(g, effect as { condition?: ConditionNode }, src) && matchesFilter(g, o, (effect.filter ?? {}) as ObjectFilter, { controller: src.controller, source: src, anyZone: true })) o.tapped = false;
    }
  }
}
