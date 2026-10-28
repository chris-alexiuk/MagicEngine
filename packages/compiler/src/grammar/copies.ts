import type { Color, CopyExcept, ObjectFilter } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter, parseKeywordList } from './nouns.js';
import { COLOR_WORDS, SUPERTYPE_WORDS, subtypeOf, TYPE_NOUNS } from './words.js';

/**
 * Copy effects (CR 707): "a token that's a copy of target creature you control",
 * "enter as a copy of any creature on the battlefield", and the exceptions that follow
 * ("except it isn't legendary", "except it's a 4/4 black Zombie", CR 707.9).
 */

/** Splits "it's white, it has no mana cost, and it's a Zombie …" into its parts (not inside quotes). */
function exceptParts(text: string): string[] {
  return text
    // Hulkling: "his name is ~, he's 4/4, and he has flying and this ability" — a character card's pronouns too.
    .split(/,? and (?=(?:it|its|the token|he|his|she|her)\b)|, (?:and )?(?=(?:it|its|the token|he|his|she|her)\b)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "Spirit", "artifact", "legendary Zombie Knight" — words naming types, read into `out`. */
function typeWords(words: string[], out: CopyExcept, replaceCreatureTypes: boolean): boolean {
  const subtypes: string[] = [];
  for (const w of words) {
    const sup = SUPERTYPE_WORDS[w.toLowerCase()];
    if (sup) (out.supertypes ??= []).push(sup);
    else if (TYPE_NOUNS[w.toLowerCase()] && w === w.toLowerCase()) (out.addTypes ??= []).push(TYPE_NOUNS[w]!);
    else if (subtypeOf(w) === w) subtypes.push(w);
    else return false;
  }
  if (subtypes.length) {
    if (replaceCreatureTypes) out.setCreatureTypes = subtypes;
    else out.addSubtypes = subtypes;
  }
  return true;
}

/** CR 707.9: "except it isn't legendary", "except it's 1/1 and it has flying". */
export function parseCopyExcept(text: string, b: Binder): CopyExcept | null {
  const out: CopyExcept = {};
  // Saw in Half: "their base power is half that creature's power and their base toughness is half that creature's
  // toughness, rounded up".
  if (/^(?:its|their) (?:base )?power is half that creature's power and (?:its|their) (?:base )?toughness is half that creature's toughness, rounded up$/.test(text.trim())) return { halfStats: 'up' };
  const parts = exceptParts(text.trim());
  if (!parts.length) return null;
  for (const part of parts) {
    const p = part
      .replace(/^(?:the token|he|she|they)\b/, 'it')
      .replace(/^(?:his|her|their) name\b/, 'its name')
      .replace(/^it is\b|^it's\b|^he's\b|^she's\b/, "it's")
      .replace(/^it's not\b/, "it isn't");
    if (/^it's legendary$/.test(p)) {
      out.supertypes = ['Legendary'];
      continue;
    }
    if (/^it isn't legendary$/.test(p)) {
      out.nonlegendary = true;
      continue;
    }
    if (/^it has no mana cost$/.test(p)) {
      out.noManaCost = true;
      continue;
    }
    const name = /^its name is (.+)$/.exec(p);
    // Not a list of other exceptions run on ("his name is ~, he's a legendary 4/4 …").
    if (name && /,\s+(?:it|he|she|they)(?:'s| is| has| have)\b| until /.test(name[1]!)) return null;
    if (name) {
      // Hulkling: "his name is Hulkling, Young Avenger" — its own name, written "~" by then.
      out.name = name[1] === '~' ? (b.env.faceName || b.env.cardName) : name[1]!;
      continue;
    }
    const pt = /^it's (\d+)\/(\d+)$/.exec(p);
    if (pt) {
      out.power = Number(pt[1]);
      out.toughness = Number(pt[2]);
      continue;
    }
    const color = /^it's (white|blue|black|red|green)(?: and (white|blue|black|red|green))?$/.exec(p);
    if (color) {
      out.colors = [color[1], color[2]].filter(Boolean).map((c) => COLOR_WORDS[c!]!) as Color[];
      continue;
    }
    // "it's a 3/3 black Zombie creature in addition to its other types"
    const addition = /^it's (?:a |an )?(?:(\d+)\/(\d+) )?((?:(?:white|blue|black|red|green) )*)(.+) in addition to its other types$/.exec(p);
    if (addition) {
      if (addition[1]) {
        out.power = Number(addition[1]);
        out.toughness = Number(addition[2]);
      }
      const colors = addition[3]!.trim().split(' ').filter(Boolean);
      if (colors.length) out.colors = colors.map((c) => COLOR_WORDS[c]!) as Color[];
      if (!typeWords(addition[4]!.split(' '), out, false)) return null;
      continue;
    }
    // "it's a 4/4 black Zombie": the stated colors and creature types replace its own.
    const becomes = /^it's (?:a|an) (?:(\d+)\/(\d+) )?((?:(?:white|blue|black|red|green) )*)([A-Z][\w-]*(?: [A-Z][\w-]*)*)$/.exec(p);
    if (becomes) {
      if (becomes[1]) {
        out.power = Number(becomes[1]);
        out.toughness = Number(becomes[2]);
      }
      const colors = becomes[3]!.trim().split(' ').filter(Boolean);
      if (colors.length) out.colors = colors.map((c) => COLOR_WORDS[c]!) as Color[];
      if (!typeWords(becomes[4]!.split(' '), out, true)) return null;
      continue;
    }
    // Spark Double: "it enters with an additional +1/+1 counter on it if it's a creature"
    const counter = /^it enters with an additional (\S+) counter on it(?: if it's an? (creature|planeswalker|artifact|enchantment|land))?$/.exec(p);
    if (counter) {
      (out.entersWith ??= []).push({ counter: counter[1]!, amount: 1, ...(counter[2] ? { ifType: counter[2][0]!.toUpperCase() + counter[2].slice(1) } : {}) });
      continue;
    }
    if (/^it has this ability$/.test(p)) {
      out.keepThisAbility = true;
      continue;
    }
    // Hulkling: "he has flying and this ability".
    const hasAndThis = /^it has (.+) and this ability$/.exec(p);
    if (hasAndThis) {
      const kws = parseKeywordList(hasAndThis[1]!, b, true);
      if (!kws?.length) return null;
      (out.keywords ??= []).push(...kws);
      out.keepThisAbility = true;
      continue;
    }
    const has = /^it has (.+)$/.exec(p);
    if (has) {
      const kws = parseKeywordList(has[1]!, b, true);
      if (!kws?.length) return null;
      (out.keywords ??= []).push(...kws);
      continue;
    }
    return null;
  }
  return out;
}

/** "any creature on the battlefield", "a creature you control", "another artifact or creature you control". */
export function parseCopyCandidates(text: string, b: Binder): ObjectFilter | null {
  let t = text.trim();
  const other = /^another /.test(t);
  t = t.replace(/^(?:any|a|an|another) /, '').replace(/ on the battlefield$/, '');
  const pf = parseFilter(t, b);
  // Body Double: "any creature card in a graveyard" (its copiable values are the card's, CR 707.2).
  if (!pf || pf.plural || (pf.filter.zone && pf.filter.zone !== 'battlefield' && pf.filter.zone !== 'graveyard')) return null;
  return other ? { ...pf.filter, other: true } : pf.filter;
}
