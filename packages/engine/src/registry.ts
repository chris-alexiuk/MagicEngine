import type { ActivatedAbility, EffectNode, StaticAbility } from '@mtg/schema';
import type { GameEvent, GameObject, GameState, ManaColor, PlayerId } from './types.js';

/**
 * Mechanic registries. The compiler emits AST nodes with string tags; the engine
 * looks those tags up here. A mechanic plugin registers its handlers at import
 * time. Unknown tags fall back to manual resolution, never to a crash.
 */

export interface EffectContext {
  g: GameState;
  controller: PlayerId;
  source?: GameObject;
  /** Player's choice for this effect (e.g. which mana option), when it needs one. */
  choice?: number | ManaColor;
  events: GameEvent[];
}

/** Returns false if the effect couldn't be carried out automatically. */
export type EffectHandler = (node: EffectNode, ctx: EffectContext) => boolean;

/** A static ability that modifies how its permanent enters the battlefield (CR 614.12). */
export type EnterReplacement = (node: EffectNode, o: GameObject, g: GameState) => void;

export interface MechanicPlugin {
  id: string;
  effects?: Record<string, EffectHandler>;
  enterReplacements?: Record<string, EnterReplacement>;
}

const effects = new Map<string, EffectHandler>();
const enterReplacements = new Map<string, EnterReplacement>();
const plugins: string[] = [];

export function installPlugin(plugin: MechanicPlugin): void {
  if (plugins.includes(plugin.id)) return;
  plugins.push(plugin.id);
  for (const [type, h] of Object.entries(plugin.effects ?? {})) effects.set(type, h);
  for (const [type, h] of Object.entries(plugin.enterReplacements ?? {})) enterReplacements.set(type, h);
}

export function installedPlugins(): readonly string[] {
  return plugins;
}

export function hasEffectHandler(type: string): boolean {
  return effects.has(type);
}

export function runEffect(node: EffectNode, ctx: EffectContext): boolean {
  const handler = effects.get(node.type);
  return handler ? handler(node, ctx) : false;
}

/** True when the engine can run every effect of an ability on its own. */
export function canAutomate(ability: ActivatedAbility | { effects: EffectNode[] }): boolean {
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
