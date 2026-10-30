import type { Color } from './index.js';
import { SUBTYPES } from './subtypes.js';

/**
 * CR 702.16a / 702.11d: one quality of "protection from …" or "hexproof from …", read so the compiler and the
 * engine agree on what's understood. A keyword whose qualities don't all read is left to players.
 */
export type Quality =
  /** CR 702.16j: "protection from everything". */
  | { kind: 'everything' }
  /** "protection from red". */
  | { kind: 'color'; color: Color }
  /** "protection from each color" (CR 105.2: each of the five colors). */
  | { kind: 'colored' }
  | { kind: 'multicolored' }
  | { kind: 'monocolored' }
  | { kind: 'colorless' }
  /** "the chosen color", "that color": the color chosen for the source of the effect (bound when granted). */
  | { kind: 'chosen_color' }
  /** "the color of your choice", "the color of its controller's choice", "colorless or from the color of your
   * choice": chosen as the effect that grants it resolves. */
  | { kind: 'choice'; chooser: 'you' | 'its_controller'; colorless?: true; /** Apostle's Blessing: "artifacts or from the color of your choice". */ artifacts?: true }
  /** Pippin: "the card type of your choice" — chosen as the effect that grants it resolves. */
  | { kind: 'type_choice' }
  /** Objects of a kind: "artifacts", "Goblins", "non-Human creatures", "creatures your opponents control",
   * "permanents with corruption counters on them", "spells that are one or more colors". */
  | { kind: 'objects'; match: QualityObjects }
  /** "mana value 3 or less", "mana value 3 or greater". */
  | { kind: 'mana_value'; n: number; cmp: 'lte' | 'gte' | 'eq' }
  /** "each of your opponents" (CR 702.16k: from a player — what they control). */
  | { kind: 'opponents' }
  /** True-Name Nemesis: "the chosen player" — chosen as it entered. */
  | { kind: 'chosen_player' }
  /** Serra's Emissary: "the chosen card type" — chosen as its source entered (bound when granted). */
  | { kind: 'chosen_card_type' }
  /** Runed Halo: "the chosen card name" — what its source's controller named as it entered. */
  | { kind: 'chosen_name' }
  /** Earnest Fellowship: "each of its colors". */
  | { kind: 'its_colors' }
  /** Pledge of Loyalty: "each color among permanents you control". */
  | { kind: 'colors_among_yours' }
  /** Rebbec: "each mana value among artifacts you control". */
  | { kind: 'mana_values_among_yours'; type: string }
  /** Commander's Plate: "each color that's not in your commander's color identity" (CR 903.4). */
  | { kind: 'outside_identity' };

export interface QualityObjects {
  /** Has every one of these card types. */
  types?: string[];
  /** Has this subtype; or not ("non-Human creatures"). */
  subtype?: string;
  notSubtype?: string;
  supertype?: string;
  color?: Color;
  /** "… your opponents control". */
  opponents?: true;
  /** A spell (on the stack). */
  spell?: true;
  /** "… that are one or more colors". */
  colored?: true;
  /** "… with corruption counters on them" (a permanent). */
  counter?: string;
  /** "creatures of the chosen type": the creature type chosen for the source (bound when granted). */
  chosenType?: true;
  /** CR 701.54e: "Ring-bearers". */
  ringBearer?: true;
}

const COLOR: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const TYPES: Record<string, string> = {
  artifact: 'Artifact', creature: 'Creature', enchantment: 'Enchantment', instant: 'Instant', sorcery: 'Sorcery',
  planeswalker: 'Planeswalker', land: 'Land', battle: 'Battle',
};
const TYPE_PLURALS: Record<string, string> = {
  artifacts: 'Artifact', creatures: 'Creature', enchantments: 'Enchantment', instants: 'Instant', sorceries: 'Sorcery',
  planeswalkers: 'Planeswalker', lands: 'Land', battles: 'Battle',
};
const SUPERTYPES: Record<string, string> = { legendary: 'Legendary', snow: 'Snow', basic: 'Basic' };

let SUBTYPE_FORMS: Map<string, string> | null = null;
/** "goblins", "elves", "arcane", "kavu" → the subtype. */
function subtypeWord(word: string): string | null {
  if (!SUBTYPE_FORMS) {
    SUBTYPE_FORMS = new Map();
    for (const list of Object.values(SUBTYPES)) {
      for (const t of list) {
        const l = t.toLowerCase();
        for (const form of [l, `${l}s`, `${l}es`, l.replace(/y$/, 'ies'), l.replace(/f$/, 'ves')]) if (!SUBTYPE_FORMS.has(form)) SUBTYPE_FORMS.set(form, t);
      }
    }
  }
  return SUBTYPE_FORMS.get(word) ?? null;
}

/** The qualities of one keyword's text: "black and from green", "artifacts, creatures, and enchantments". */
/** The card types a "card type of your choice" can be (CR 205.2a), as their plural nouns. */
export const CARD_TYPE_PLURALS: readonly string[] = ['artifacts', 'battles', 'creatures', 'enchantments', 'instants', 'lands', 'planeswalkers', 'sorceries'];

/** "Artifact" → "artifacts" (a quality's words). */
export function cardTypePlural(type: string): string | undefined {
  return Object.keys(TYPE_PLURALS).find((k) => TYPE_PLURALS[k] === type);
}

export function splitQualities(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s*(?:,\s*)?and from\s+|,\s*from\s+/)
    .flatMap((q) => {
      // Nevinyrral: "artifacts, creatures, and enchantments" — a list of card types.
      const parts = q.split(/,\s*(?:and\s+)?|\s+and\s+/);
      return parts.length > 1 && parts.every((p) => TYPE_PLURALS[p.trim()]) ? parts : [q];
    })
    .map((q) => q.trim());
}

/** "creatures", "Goblins", "non-Human creatures", "legendary creatures", "red creatures", "artifact creatures". */
function readObjects(q: string): QualityObjects | null {
  if (TYPE_PLURALS[q]) return { types: [TYPE_PLURALS[q]!] };
  const sub = subtypeWord(q);
  if (sub) return { subtype: sub };
  if (SUPERTYPES[q]) return { supertype: SUPERTYPES[q] };
  if (q === 'creatures of the chosen type') return { types: ['Creature'], chosenType: true };
  if (q === 'creatures your opponents control') return { types: ['Creature'], opponents: true };
  if (q === 'ring-bearers') return { ringBearer: true };
  if (q === 'spells that are one or more colors') return { spell: true, colored: true };
  const counters = /^permanents with (\w+) counters on them$/.exec(q);
  if (counters) return { counter: counters[1]! };
  const adj = /^(non-?)?([\w-]+) (creatures|permanents)$/.exec(q);
  if (adj) {
    const [, non, word, noun] = adj;
    const base = noun === 'creatures' ? { types: ['Creature'] } : {};
    const st = subtypeWord(word!) ?? subtypeWord(`${word}s`);
    if (non) return st ? { ...base, notSubtype: st } : null;
    if (st) return { ...base, subtype: st };
    if (SUPERTYPES[word!]) return { ...base, supertype: SUPERTYPES[word!] };
    if (COLOR[word!]) return { ...base, color: COLOR[word!] };
    if (TYPES[word!] && noun === 'creatures') return { types: [TYPES[word!]!, 'Creature'] };
  }
  return null;
}

/** One quality, or null if the engine can't tell what has it. */
export function readQuality(q: string): Quality | null {
  if (q === 'everything') return { kind: 'everything' };
  if (COLOR[q]) return { kind: 'color', color: COLOR[q]! };
  if (q === 'each color' || q === 'all colors') return { kind: 'colored' };
  if (q === 'multicolored' || q === 'monocolored' || q === 'colorless') return { kind: q };
  if (q === 'the chosen color' || q === 'that color') return { kind: 'chosen_color' };
  if (q === 'the color of your choice') return { kind: 'choice', chooser: 'you' };
  if (q === "the color of its controller's choice") return { kind: 'choice', chooser: 'its_controller' };
  if (q === 'colorless or from the color of your choice') return { kind: 'choice', chooser: 'you', colorless: true };
  if (q === 'artifacts or from the color of your choice') return { kind: 'choice', chooser: 'you', artifacts: true };
  if (q === 'the card type of your choice') return { kind: 'type_choice' };
  const mv = /^mana value (\d+)(?: or (less|greater))?$/.exec(q);
  if (mv) return { kind: 'mana_value', n: Number(mv[1]), cmp: mv[2] === 'less' ? 'lte' : mv[2] === 'greater' ? 'gte' : 'eq' };
  if (q === 'each of your opponents') return { kind: 'opponents' };
  if (q === 'the chosen player') return { kind: 'chosen_player' };
  if (q === 'the chosen card type') return { kind: 'chosen_card_type' };
  if (q === 'the chosen card name' || q === 'the chosen name') return { kind: 'chosen_name' };
  if (q === 'each of its colors') return { kind: 'its_colors' };
  if (q === 'each color among permanents you control') return { kind: 'colors_among_yours' };
  const among = /^each mana value among (artifacts|creatures|permanents) you control$/.exec(q);
  if (among) return { kind: 'mana_values_among_yours', type: among[1] === 'permanents' ? '' : TYPE_PLURALS[among[1]!]! };
  if (q === "each color that's not in your commander's color identity") return { kind: 'outside_identity' };
  const objects = readObjects(q);
  return objects ? { kind: 'objects', match: objects } : null;
}

/** Whether every quality in a protection / hexproof-from keyword's text reads. */
export function qualitiesRead(text: string): boolean {
  return splitQualities(text).every((q) => readQuality(q) !== null);
}
