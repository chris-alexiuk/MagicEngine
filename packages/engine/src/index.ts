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
export { chars, hasKeyword, hasProtectionFrom, hasRule, hasType, manaAbilities, matchesFilter, power, toughness } from './characteristics.js';
export type { Characteristics, FilterContext } from './characteristics.js';
export { activatedAbilities, flatten, spellPrograms } from './program.js';
export { canChooseTargets, defaultTargets, isLegalTarget, targetCandidates, targetPrompts } from './targets.js';
export { attackRestriction, attackTargets, blockDeclarationProblem, defendingPlayers, evasionProblem as blockProblem } from './combat.js';
export { parseManaCost, payFromPool } from './mana.js';
export { hasEffectHandler, hasStaticHandler, hasTriggerMatcher, installPlugin, installedPlugins } from './registry.js';
export type { EffectContext, EffectHandler, EffectResult, EnterReplacement, MechanicPlugin, TriggerCheck, TriggerMatcher } from './registry.js';
export * from './types.js';
