import { GRAMMAR_RULES } from '../grammar/lines.js';
import type { GrammarRule } from '../parser.js';
import { manaAbilityRule } from './mana.js';
import { entersTappedRule } from './static.js';

/**
 * Grammar rules, tried in order. The coverage report ranks the oracle
 * templates that no rule handles yet, which is the to-do list for these files.
 */
export const CORE_RULES: GrammarRule[] = [manaAbilityRule, entersTappedRule, ...GRAMMAR_RULES];
