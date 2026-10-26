import type { Amount, Color } from '@mtg/schema';
import { SUBTYPES } from '@mtg/schema';

/** Small vocabulary shared by the grammar rules. */

export const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20,
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
  SUBTYPE_PLURALS.set(`${t}s`, t);
  if (/(?:s|sh|ch|x|z)$/.test(t)) SUBTYPE_PLURALS.set(`${t}es`, t);
  if (/[^aeiou]y$/.test(t)) SUBTYPE_PLURALS.set(`${t.slice(0, -1)}ies`, t);
  if (/f$/.test(t)) SUBTYPE_PLURALS.set(`${t.slice(0, -1)}ves`, t); // Elf → Elves, Wolf → Wolves
  if (/fe$/.test(t)) SUBTYPE_PLURALS.set(`${t.slice(0, -2)}ves`, t);
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
