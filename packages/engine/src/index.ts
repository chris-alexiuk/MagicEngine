/**
 * MagicEngine rules engine.
 *
 *   - Pure and deterministic: no DOM, no clock, no Math.random. Same seed and
 *     same actions give the same game, in a Web Worker or on the server.
 *   - createGame() sets up; apply(state, action) is the only way state changes.
 *     It returns the new state plus the events it produced.
 *   - When a player must decide, state.pending says who and what.
 *   - Card behaviour comes from the compiled AST through registries (registry.ts);
 *     anything without a handler is resolved by hand.
 *   - Rules are cited as "CR x.y" next to the code that implements them;
 *     `pnpm rules:trace` turns those citations into docs/rules/TRACE.md.
 */
import './core-plugin.js';

export { apply } from './actions.js';
export { createGame, defaultConfig } from './setup.js';
export type { NewGameOptions, PlayerSetup } from './setup.js';
export { legalActions } from './legal.js';
export { viewFor } from './view.js';
export type { PlayerView } from './view.js';
export { planAutoTap } from './autotap.js';
export { manaAbilities, power, toughness } from './characteristics.js';
export { parseManaCost, payFromPool } from './mana.js';
export { installPlugin, installedPlugins } from './registry.js';
export type { EffectContext, EffectHandler, EnterReplacement, MechanicPlugin } from './registry.js';
export * from './types.js';
