import type { GrammarRule } from '../parser.js';
import { manaAbilityRule } from './mana.js';
import { attachedPumpRule, entersTappedRule } from './static.js';

/**
 * Grammar rules, tried in order. The coverage report ranks the oracle
 * templates that no rule handles yet, which is the to-do list for this file.
 */
export const CORE_RULES: GrammarRule[] = [manaAbilityRule, entersTappedRule, attachedPumpRule];
