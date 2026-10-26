import type { CombatRules } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter } from './nouns.js';
import { parseAmount } from './words.js';

/**
 * Blocking restrictions and requirements in a predicate (CR 509.1b–c):
 * "can't be blocked by creatures with power 2 or less", "can't be blocked by more than one creature",
 * "can't be blocked except by three or more creatures", "can block only creatures with flying",
 * "must be blocked if able".
 */
export function parseCombatRule(predicate: string, b: Binder): CombatRules | null {
  const p = predicate.trim();
  if (/^must be blocked(?: this turn)? if able$/.test(p)) return { mustBeBlocked: 'one' };
  if (/^can't be blocked by more than one creature(?: each combat)?$/.test(p)) return { maxBlockers: 1 };
  const except = /^can't be blocked except by (.+)$/.exec(p);
  if (except) {
    const n = /^(\w+) or more creatures$/.exec(except[1]!);
    if (n) {
      const amount = parseAmount(n[1]!);
      return typeof amount === 'number' ? { minBlockers: amount } : null;
    }
    const pf = parseFilter(except[1]!, b);
    return pf && pf.plural ? { blockableOnlyBy: pf.filter } : null;
  }
  const by = /^can't be blocked by (.+)$/.exec(p);
  if (by) {
    const pf = parseFilter(by[1]!, b);
    return pf && pf.plural ? { cantBeBlockedBy: pf.filter } : null;
  }
  const only = /^can block only (.+)$/.exec(p);
  if (only) {
    const pf = parseFilter(only[1]!, b);
    return pf && pf.plural ? { canBlockOnly: pf.filter } : null;
  }
  return null;
}
