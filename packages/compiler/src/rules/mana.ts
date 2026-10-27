import type { ActivatedAbility, AddManaEffect, Cost } from '@mtg/schema';
import type { GrammarRule } from '../parser.js';

const MANA_SYMBOL = String.raw`\{(?:\d+|[WUBRGCSX]|[WUBRG2]\/[WUBRGP])\}`;
const MANA_RUN = new RegExp(`^(?:${MANA_SYMBOL})+$`);
const PRODUCED_RUN = /^(?:\{[WUBRGC]\})+$/;

/** "{1}, {T}" → { mana: "{1}", tap: true }. Returns null for costs v0 can't express (sacrifice, life…). */
export function parseSimpleCost(text: string): Cost | null {
  const cost: Cost = {};
  let mana = '';
  for (const item of text.split(/,\s*/)) {
    if (item === '{T}') cost.tap = true;
    else if (item === '{Q}') cost.untap = true;
    else if (MANA_RUN.test(item)) mana += item;
    else return null;
  }
  if (mana) cost.mana = mana;
  return cost;
}

function symbols(run: string): string[] {
  return [...run.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
}

const COUNT: Record<string, number> = { two: 2, three: 3, four: 4 };
const ALL_COLORS = ['W', 'U', 'B', 'R', 'G'];

/** Every multiset of `n` symbols from `colors` (with `distinct`, no repeats), as option lists. */
function combinations(colors: string[], n: number, distinct = false): string[][] {
  if (n === 0) return [[]];
  return colors.flatMap((c, i) => combinations(colors.slice(distinct ? i + 1 : i), n - 1, distinct).map((rest) => [c, ...rest]));
}

/** "{G}", "{C}{C}", "{R} or {G}", "{W}, {U}, or {B}", "one mana of any color". */
export function parseManaProduction(text: string): AddManaEffect | null {
  if (text === 'one mana of any color') return { type: 'add_mana', anyColor: 1 };
  // CR 903.4: Command Tower, Arcane Signet.
  if (text === "one mana of any color in your commander's color identity") return { type: 'add_mana', anyColor: 1, identity: true };
  const anyOne = /^(two|three|four|five) mana of any one color$/.exec(text);
  if (anyOne) return { type: 'add_mana', anyColor: ['two', 'three', 'four', 'five'].indexOf(anyOne[1]!) + 2 };
  if (PRODUCED_RUN.test(text)) return { type: 'add_mana', options: [symbols(text)] };
  // CR 106.1b-style choices: "two mana in any combination of colors", "… of {R} and/or {G}", "two mana of different colors".
  const combo = /^(two|three|four) mana in any combination of (colors|\{([WUBRG])\} and\/or \{([WUBRG])\})$/.exec(text);
  if (combo) return { type: 'add_mana', options: combinations(combo[3] ? [combo[3], combo[4]!] : ALL_COLORS, COUNT[combo[1]!]!) };
  const different = /^(two|three) mana of different colors$/.exec(text);
  if (different) return { type: 'add_mana', options: combinations(ALL_COLORS, COUNT[different[1]!]!, true) };
  // "one mana of the chosen color" (CR 614.12: chosen as the source entered).
  const CHOSEN = 'one mana of the chosen color';
  if (text === CHOSEN) return { type: 'add_mana', options: [['chosen']] };
  const alternatives = text.split(/,? or |, /);
  if (alternatives.length > 1 && alternatives.every((a) => PRODUCED_RUN.test(a) || a === CHOSEN)) {
    return { type: 'add_mana', options: alternatives.map((a) => (a === CHOSEN ? ['chosen'] : symbols(a))) };
  }
  return null;
}

/** "{T}: Add {G}." and friends — mana abilities (CR 605) with simple costs. */
export const manaAbilityRule: GrammarRule = {
  id: 'mana_ability',
  parse(line, original) {
    const m = /^(.+?): Add (.+)\.$/.exec(line);
    if (!m) return null;
    const cost = parseSimpleCost(m[1]!);
    const effect = cost && parseManaProduction(m[2]!);
    if (!cost || !effect) return null;
    const node: ActivatedAbility = { kind: 'activated', text: original, cost, effects: [effect], mana: true };
    return node;
  },
};
