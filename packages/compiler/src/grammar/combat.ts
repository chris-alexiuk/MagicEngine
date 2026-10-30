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
  // Shiny Impetus: "Enchanted creature … is goaded" (a static ability; see goaders in the engine).
  if (/^(?:is|are) goaded$/.test(p)) return { goaded: true };
  // Vow of Duty: "Enchanted creature … can't attack you or planeswalkers you control." — the source's controller (CR 508.1c).
  if (/^can't attack you or planeswalkers you control$/.test(p)) return { cantAttackYou: true };
  if (/^can't be blocked by more than one creature(?: each combat)?$/.test(p)) return { maxBlockers: 1 };
  // CR 509.1a: blocking more than one attacker.
  // Watcher in the Web: "can block an additional seven creatures each combat".
  // Hundred-Handed One: "can block an additional ninety-nine creatures each combat".
  const additional = /^can block (?:an additional(?: ([\w-]+))?|(\w+) additional) creatures?(?: each combat)?$/.exec(p)?.map((x, i, m) => (i === 1 ? m[1] ?? m[2] : x));
  if (additional) {
    const n = additional[1] === 'ninety-nine' ? 99 : additional[1] ? parseAmount(additional[1]) : 1;
    return typeof n === 'number' ? { extraBlocks: n } : null;
  }
  if (/^can block any number of creatures(?: each combat)?$/.test(p)) return { extraBlocks: 99 };
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
  // Skrelv, Defector Mite: "Choose a color. … It can't be blocked by creatures of that color this turn." — the color chosen.
  if (p === "can't be blocked by creatures of that color" && b.choseColor) return { cantBeBlockedBy: { types: ['Creature'], colors: ['chosen' as never] } };
  // Lost in the Spirit World: "This token can't block or be blocked by non-Spirit creatures."
  const either = /^can't block or be blocked by (.+)$/.exec(p);
  if (either) {
    const pf = parseFilter(either[1]!, b);
    return pf && pf.plural ? { cantBeBlockedBy: pf.filter, cantBlockOf: pf.filter } : null;
  }
  const by = /^can't be blocked by (.+)$/.exec(p);
  // Doorman: "can't be blocked by creatures with power 2 or less and/or Walls"; Temple Thief: "… by enchanted creatures or
  // enchantment creatures" — by either.
  const byEither = by ? /^(.+?) and\/or (.+)$/.exec(by[1]!) ?? (!parseFilter(by[1]!, b.clone()) ? /^(.+? creatures) or (.+? creatures)$/.exec(by[1]!) : null) : null;
  if (byEither) {
    const one = parseFilter(byEither[1]!, b.clone());
    const two = one ? parseFilter(byEither[2]!, b.clone()) : null;
    if (one?.plural && two?.plural) return { cantBeBlockedBy: { anyOf: [one.filter, two.filter] } };
  }
  if (by) {
    const pf = parseFilter(by[1]!, b);
    return pf && pf.plural ? { cantBeBlockedBy: pf.filter } : null;
  }
  // Scrapdiver Serpent: "can't be blocked as long as defending player controls an artifact" — like landwalk (CR 702.14c).
  const walkLike = /^can't be blocked as long as defending player controls (?:a|an) (.+)$/.exec(p);
  if (walkLike) {
    const pf = parseFilter(walkLike[1]!, b);
    return pf && !pf.plural && !pf.filter.zone && !pf.filter.controller ? { unblockableIfDefenderControls: pf.filter } : null;
  }
  // "can't attack unless defending player controls an Island" (CR 508.1c)
  const unless = /^can't attack unless defending player controls (?:a|an) (.+)$/.exec(p);
  if (unless) {
    const pf = parseFilter(unless[1]!, b);
    return pf && !pf.plural ? { attackOnlyIfDefenderControls: pf.filter } : null;
  }
  // Spectral Grasp: "can't block creatures you control".
  // Zurgo Bellstriker: "can't block creatures with power 2 or greater".
  // Hunted Ghoul: "can't block Humans"; Orcish Veteran: "can't block white creatures with power 2 or greater".
  const cantBlockOf = /^can't block ((?:[a-z]+ )*creatures (?:you control|your opponents control|with power \d+ or (?:greater|less)|with power greater than ~'s power)|(?:(?:white|blue|black|red|green|artifact|nonartifact|colorless) )+creatures(?: with (?:power \d+ or (?:greater|less)|flying))?|[A-Z][a-z]+s)$/.exec(p);
  if (cantBlockOf) {
    const pf = parseFilter(cantBlockOf[1]!, b);
    return pf && pf.plural ? { cantBlockOf: pf.filter } : null;
  }
  // Heartwood Dryad: "can block creatures with shadow as though it had shadow".
  if (p === 'can block creatures with shadow as though it had shadow') return { blocksShadow: true };
  const only = /^can block only (.+)$/.exec(p);
  if (only) {
    const pf = parseFilter(only[1]!, b);
    return pf && pf.plural ? { canBlockOnly: pf.filter } : null;
  }
  return null;
}
