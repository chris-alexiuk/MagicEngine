import type { Amount, Color } from '@mtg/schema';
import { SUBTYPES } from '@mtg/schema';

/** Small vocabulary shared by the grammar rules. */

export const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, hundred: 100,
  // Baldin: "up to one hundred target creatures".
  'one hundred': 100,
};

/** "a", "two", "3", "X" → amount. */
export function parseAmount(word: string): Amount | null {
  const w = word.trim();
  if (w === 'X') return 'X';
  if (/^\d+$/.test(w)) return Number(w);
  return NUMBER_WORDS[w.toLowerCase()] ?? null;
}

/** "+2/+0", "-1/-1", "+X/+0", "-X/-X" → amounts (X is bound later: paid, or "where X is …"). */
export function parsePT(text: string): { power: Amount; toughness: Amount } | null {
  const m = /^([+-](?:\d+|X))\/([+-](?:\d+|X))$/.exec(text.replace(/−/g, '-'));
  if (!m) return null;
  const one = (v: string): Amount => (v === '+X' ? 'X' : v === '-X' ? { kind: 'x', times: -1 } : Number(v));
  return { power: one(m[1]!), toughness: one(m[2]!) };
}

export const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/** CR 205.2a — the card types that matter on the battlefield and the stack, keyed by their singular and plural nouns. */
export const TYPE_NOUNS: Record<string, string> = {
  artifact: 'Artifact', artifacts: 'Artifact',
  battle: 'Battle', battles: 'Battle',
  creature: 'Creature', creatures: 'Creature',
  enchantment: 'Enchantment', enchantments: 'Enchantment',
  instant: 'Instant', instants: 'Instant',
  kindred: 'Kindred',
  land: 'Land', lands: 'Land',
  planeswalker: 'Planeswalker', planeswalkers: 'Planeswalker',
  sorcery: 'Sorcery', sorceries: 'Sorcery',
};

/** CR 205.4a. */
export const SUPERTYPE_WORDS: Record<string, string> = { basic: 'Basic', legendary: 'Legendary', snow: 'Snow', world: 'World' };

const SUBTYPE_SET = new Set(Object.values(SUBTYPES).flat());
const SUBTYPE_PLURALS = new Map<string, string>();
for (const t of SUBTYPE_SET) {
  SUBTYPE_PLURALS.set(t, t);
  // Urza's Workshop: "for each Urza's land you control" — rules text is read with straight apostrophes.
  if (t.includes('’')) SUBTYPE_PLURALS.set(t.replace(/’/g, "'"), t);
  SUBTYPE_PLURALS.set(`${t}s`, t);
  // She-Hulk, Wallbreaker: "Other Heroes you control".
  if (/(?:s|sh|ch|x|z|o)$/.test(t)) SUBTYPE_PLURALS.set(`${t}es`, t);
  if (/[^aeiou]y$/.test(t)) SUBTYPE_PLURALS.set(`${t.slice(0, -1)}ies`, t);
  if (/f$/.test(t)) SUBTYPE_PLURALS.set(`${t.slice(0, -1)}ves`, t); // Elf → Elves, Wolf → Wolves
  if (/fe$/.test(t)) SUBTYPE_PLURALS.set(`${t.slice(0, -2)}ves`, t);
}
// Irregular plurals in Oracle text: "Mice", "Oxen", "Dwarves", "Octopi" aren't formed by the rules above.
for (const [plural, t] of [['Mice', 'Mouse'], ['Oxen', 'Ox'], ['Dwarves', 'Dwarf'], ['Fungi', 'Fungus'], ['Homunculi', 'Homunculus'], ['Pegasi', 'Pegasus']] as const) {
  if (SUBTYPE_SET.has(t)) SUBTYPE_PLURALS.set(plural, t);
}

/**
 * Creature types printed on cards newer than the Comprehensive Rules file (Klingon, Officer, Borg…): a card's own type
 * line is authoritative for its subtypes (CR 205.3), so the pool's creature type lines add them before anything is read.
 */
export function registerPoolSubtypes(typeLines: Iterable<string>): string[] {
  const added: string[] = [];
  const multiWord = [...SUBTYPE_SET].filter((t) => t.includes(' '));
  const typeWords = /^(?:Artifact|Battle|Creature|Enchantment|Instant|Kindred|Land|Planeswalker|Sorcery|Tribal|Legendary|Basic|Snow|World|Token|Ongoing|Elite|Host)$/;
  for (const face of [...typeLines].flatMap((l) => l.split(' // '))) {
    const [types, subs] = face.split(' — ');
    if (!subs || !/\b(?:Creature|Kindred)\b/.test(types!)) continue;
    let rest = subs;
    for (const t of multiWord) rest = rest.replace(t, ' ');
    for (const word of rest.split(/\s+/)) {
      if (!/^[A-Z][A-Za-z'’-]*$/.test(word) || typeWords.test(word) || SUBTYPE_SET.has(word) || SUBTYPE_PLURALS.has(word)) continue;
      SUBTYPE_SET.add(word);
      // The same regular plurals as the rules' own types; never one that already names another type.
      const plurals = [word, `${word}s`, ...(/(?:s|sh|ch|x|z|o)$/.test(word) ? [`${word}es`] : []), ...(/[^aeiou]y$/.test(word) ? [`${word.slice(0, -1)}ies`] : [])];
      for (const pl of plurals) if (!SUBTYPE_PLURALS.has(pl)) SUBTYPE_PLURALS.set(pl, word);
      added.push(word);
    }
  }
  return added;
}

/** "Elf", "Elves", "Zombies" → the subtype (CR 205.3), else null. */
export function subtypeOf(word: string): string | null {
  return SUBTYPE_PLURALS.get(word) ?? null;
}

export const isSubtype = (word: string) => SUBTYPE_SET.has(word);

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Splits "a, b, and c" / "a and b" / "a, b" into items. */
export function splitList(text: string): string[] {
  return text
    .split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
