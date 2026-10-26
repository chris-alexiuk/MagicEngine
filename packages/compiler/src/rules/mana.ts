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

/** "{G}", "{C}{C}", "{R} or {G}", "{W}, {U}, or {B}", "one mana of any color". */
export function parseManaProduction(text: string): AddManaEffect | null {
  if (text === 'one mana of any color') return { type: 'add_mana', anyColor: 1 };
  const anyOne = /^(two|three|four|five) mana of any one color$/.exec(text);
  if (anyOne) return { type: 'add_mana', anyColor: ['two', 'three', 'four', 'five'].indexOf(anyOne[1]!) + 2 };
  if (PRODUCED_RUN.test(text)) return { type: 'add_mana', options: [symbols(text)] };
  const alternatives = text.split(/,? or |, /);
  if (alternatives.length > 1 && alternatives.every((a) => PRODUCED_RUN.test(a))) {
    return { type: 'add_mana', options: alternatives.map(symbols) };
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
