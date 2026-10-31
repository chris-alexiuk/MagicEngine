import type { CardDef } from '@mtg/schema';

/**
 * Card name matching for deck imports: case-insensitive, accent-insensitive ("Jotun Grunt" finds "Jötun Grunt"),
 * curly or straight apostrophes, and double-faced / split cards by their full name ("Fire // Ice", "Fire/Ice") or
 * their front face ("Fire", "Delver of Secrets").
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/æ/gi, 'ae')
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface CardIndex {
  /** The card a deck-list name means, if any. */
  lookup(name: string): CardDef | undefined;
  /** The card with exactly this DB name. */
  get(name: string): CardDef | undefined;
}

const commanderLegal = (c: CardDef) => c.legal.commander === 'l' || c.legal.commander === 'r';

export function buildIndex(cards: readonly CardDef[]): CardIndex {
  const exact = new Map<string, CardDef>();
  const primary = new Map<string, CardDef>();
  const secondary = new Map<string, CardDef>();
  // Two cards with one name (a rebalanced digital version, say): the one legal in Commander wins.
  const put = (map: Map<string, CardDef>, key: string, c: CardDef) => {
    const had = map.get(key);
    if (!had || (!commanderLegal(had) && commanderLegal(c))) map.set(key, c);
  };
  for (const c of cards) {
    if (!exact.has(c.name) || commanderLegal(c)) exact.set(c.name, c);
    put(primary, normalizeName(c.name), c);
    if (c.faces.length > 1) {
      put(primary, normalizeName(c.faces[0]!.name), c);
      for (const f of c.faces.slice(1)) put(secondary, normalizeName(f.name), c);
    }
  }
  return {
    get: (name) => exact.get(name),
    lookup(name) {
      const key = normalizeName(name);
      if (!key) return undefined;
      const hit = primary.get(key) ?? secondary.get(key);
      if (hit) return hit;
      // "Fire // Ice" written with a face name we don't know as a whole: try the front face.
      const front = key.split(' // ')[0]!;
      return front !== key ? (primary.get(front) ?? secondary.get(front)) : undefined;
    },
  };
}
