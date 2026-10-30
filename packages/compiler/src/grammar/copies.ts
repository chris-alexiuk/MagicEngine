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
    .split(/,? and (?=(?:it|its|the tokens?|he|his|she|her|they|their)\b)|, (?:and )?(?=(?:it|its|the tokens?|he|his|she|her|they|their)\b)/)
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

/** Runs `f` with the quoted abilities' mentions of `name` read as "this creature". */
function withSelfQuotes<T>(b: Binder, name: string, f: () => T): T {
  const quotes = b.env.quotes;
  if (!quotes) return f();
  const saved = [...quotes];
  for (let i = 0; i < quotes.length; i++) quotes[i] = quotes[i]!.split(name).join('this creature');
  try {
    return f();
  } finally {
    for (let i = 0; i < saved.length; i++) quotes[i] = saved[i]!;
  }
}

/** "… with trample", "… with crew 3" — keywords the copy has. */
function withKeywords(text: string, out: CopyExcept, b: Binder): boolean {
  const kws = parseKeywordList(text, b, true);
  if (!kws?.length) return false;
  (out.keywords ??= []).push(...kws);
  return true;
}

/** CR 707.9: "except it isn't legendary", "except it's 1/1 and it has flying". */
export function parseCopyExcept(text: string, b: Binder): CopyExcept | null {
  const out: CopyExcept = {};
  // Saw in Half: "their base power is half that creature's power and their base toughness is half that creature's
  // toughness, rounded up".
  if (/^(?:its|their) (?:base )?power is half that creature's power and (?:its|their) (?:base )?toughness is half that creature's toughness, rounded up$/.test(text.trim())) return { halfStats: 'up' };
  const t = text
    .trim()
    // Moritte of the Frost: "… and, if it's a creature, it enters with two additional +1/+1 counters on it and has haste".
    .replace(/ and, if it's an? (creature|artifact|planeswalker), it enters with (.+?) on it and has (.+)$/, " and it enters with $2 on it if it's a $1 and it has $3")
    // Auton Soldier: "it isn't legendary, is an artifact in addition to its other types, and has myriad" — the subject once.
    .replace(/,( and)? (?=(?:is|has|enters with|loses) )/g, ',$1 it ')
    .replace(/ and (?=(?:has|is an?|loses) )/g, ' and it ');
  const parts = exceptParts(t);
  if (!parts.length) return null;
  for (const part of parts) {
    // Astral Dragon: "they're 3/3 Dragon creatures in addition to their other types, and they have flying" — each token.
    const plural = /^(?:they|the tokens)\b/.test(part);
    let p = part
      .replace(/^they're\b|^they are\b|^the tokens are\b/, "it's")
      .replace(/^they have\b|^the tokens have\b/, 'it has')
      .replace(/^they aren't\b|^the tokens aren't\b/, "it isn't")
      .replace(/^(?:the token|he|she|they)\b/, 'it')
      .replace(/^(?:his|her|their) name\b/, 'its name')
      .replace(/^it is\b|^it's\b|^he's\b|^she's\b/, "it's")
      .replace(/^it's not\b/, "it isn't")
      .replace(/\btheir other\b/g, 'its other');
    if (plural) p = p.replace(/^it's (\d+\/\d+) /, "it's a $1 ").replace(/\b(creature|artifact|enchantment)s\b/g, '$1');
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
      // Mishra, Eminent One: "its name is Mishra's Warform" — the short name inside another (written "~" by then).
      out.name = name[1] === '~' ? (b.env.faceName || b.env.cardName) : name[1]!.replace(/~/g, (b.env.faceName || b.env.cardName).split(',')[0]!);
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
    // Ratadrabik: "it's a 2/2 black Zombie in addition to its other colors and types" — the colors are added too.
    // Sakashima's Student: "it's a Ninja in addition to its other creature types".
    // Kaya, Intangible Slayer: "it's a 1/1 white Spirit creature with flying in addition to its other types".
    const addition = /^it's (?:a |an )?(?:(\d+)\/(\d+) )?((?:(?:white|blue|black|red|green) (?:and )?)*)(.+?)(?: with (.+))? in addition to its other (colors and )?(creature )?types$/.exec(p);
    if (addition) {
      if (addition[1]) {
        out.power = Number(addition[1]);
        out.toughness = Number(addition[2]);
      }
      const colors = addition[3]!.replace(/\band\b/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (colors.length && addition[6]) out.addColors = colors.map((c) => COLOR_WORDS[c]!) as Color[];
      else if (colors.length) out.colors = colors.map((c) => COLOR_WORDS[c]!) as Color[];
      // Moritte of the Frost: "it's legendary and snow in addition to its other types".
      const words = addition[4]!.split(/ and | /);
      if (addition[7] && words.some((w) => subtypeOf(w) !== w)) return null;
      if (!typeWords(words, out, false)) return null;
      if (addition[5] && !withKeywords(addition[5], out, b)) return null;
      continue;
    }
    // "it's a 4/4 black Zombie": the stated colors and creature types replace its own.
    // Sauron, the Necromancer: "it's a 3/3 black Wraith with menace".
    const becomes = /^it's (?:a|an) (?:(\d+)\/(\d+) )?((?:(?:white|blue|black|red|green) (?:and )?)*)([A-Z][\w-]*(?: [A-Z][\w-]*)*)(?: with (.+))?$/.exec(p);
    if (becomes) {
      if (becomes[1]) {
        out.power = Number(becomes[1]);
        out.toughness = Number(becomes[2]);
      }
      const colors = becomes[3]!.replace(/\band\b/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (colors.length) out.colors = colors.map((c) => COLOR_WORDS[c]!) as Color[];
      if (!typeWords(becomes[4]!.split(' '), out, true)) return null;
      if (becomes[5] && !withKeywords(becomes[5], out, b)) return null;
      continue;
    }
    // Machine God's Effigy: "it's an artifact" — that's its card type now (CR 205.1a).
    // Dino DNA: "it's a 6/6 green Dinosaur creature with trample". Imposter Mech: "it's a Vehicle artifact with crew 3".
    const retyped = /^it's (?:a|an) (?:(\d+)\/(\d+) )?((?:(?:white|blue|black|red|green) (?:and )?)*)((?:[A-Z][\w-]* )*)((?:artifact|enchantment|creature|land)(?: (?:artifact|enchantment|creature|land))*)(?: with (.+))?$/.exec(p);
    if (retyped) {
      if (retyped[1]) {
        out.power = Number(retyped[1]);
        out.toughness = Number(retyped[2]);
      }
      const colors = retyped[3]!.replace(/\band\b/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (colors.length) out.colors = colors.map((c) => COLOR_WORDS[c]!) as Color[];
      out.setTypes = retyped[5]!.split(' ').map((w) => TYPE_NOUNS[w]!);
      const subtypes = retyped[4]!.trim().split(' ').filter(Boolean);
      if (subtypes.some((w) => subtypeOf(w) !== w)) return null;
      if (subtypes.length && out.setTypes.includes('Creature')) out.setCreatureTypes = subtypes;
      else if (subtypes.length) out.addSubtypes = subtypes;
      if (retyped[6] && !withKeywords(retyped[6], out, b)) return null;
      continue;
    }
    // Imposter Mech, Espers to Magicite: "… and it loses all other card types" — the types it was just given are its only ones.
    // Shelob, Child of Ungoliant: "… and it loses all other card types and creature types".
    const loses = /^it loses all other card types( and creature types)?$/.exec(p);
    if (loses) {
      if (!out.setTypes) {
        if (!out.addTypes?.length) return null;
        out.setTypes = out.addTypes;
        delete out.addTypes;
      }
      if (loses[1] && out.setTypes.includes('Creature')) out.setCreatureTypes = [];
      continue;
    }
    // Spark Double: "it enters with an additional +1/+1 counter on it if it's a creature".
    // Altered Ego: "it enters with X additional +1/+1 counters on it". Undercover Operative: "… a shield counter on it if you control that creature".
    const counter = /^it enters with (an|a|one|two|three|four|five|X)(?: additional)? (\S+) counters? on it(?: if it's an? (creature|planeswalker|artifact|enchantment|land)| if you control that creature)?$/.exec(p);
    if (counter) {
      const amount = counter[1] === 'X' ? 'X' : ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[counter[1]!]!;
      (out.entersWith ??= []).push({ counter: counter[2]!, amount, ...(counter[3] ? { ifType: counter[3][0]!.toUpperCase() + counter[3].slice(1) } : {}), ...(/if you control that creature$/.test(p) ? { ifControlled: true as const } : {}) });
      continue;
    }
    // Jace, Mirror Mage: "its starting loyalty is 1".
    const loyalty = /^its starting loyalty is (\d+)$/.exec(p);
    if (loyalty) {
      out.loyalty = Number(loyalty[1]);
      continue;
    }
    if (/^it has this ability$/.test(p)) {
      out.keepThisAbility = true;
      continue;
    }
    // Sakashima of a Thousand Faces: "except it has Sakashima's other abilities".
    if (/^it has ~'s other abilities$/.test(p)) {
      out.keepOtherAbilities = true;
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
      // Sakashima the Impostor: "except its name is Sakashima the Impostor, …, and it has "{2}{U}{U}: Return Sakashima the
      // Impostor to its owner's hand …"" — named after this card, the copy's quoted ability means the copy itself.
      const kws = out.name && out.name === b.env.cardName ? withSelfQuotes(b, out.name, () => parseKeywordList(has[1]!, b, true)) : parseKeywordList(has[1]!, b, true);
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
