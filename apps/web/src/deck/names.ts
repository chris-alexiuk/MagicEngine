import type { AltName, CardDef } from '@mtg/schema';

/**
 * Card name matching for deck imports: case-insensitive, accent-insensitive ("Jotun Grunt" finds "Jötun Grunt"),
 * curly or straight apostrophes, and double-faced / split cards by their full name ("Fire // Ice", "Fire/Ice") or
 * their front face ("Fire", "Delver of Secrets"). A name a card is only printed under on some printing ("Seymour
 * Guado" on a Kinnan, Bonder Prodigy) finds the card too, and says which printing that was.
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

export interface Found {
  card: CardDef;
  /** The printing the name belongs to, when it isn't the card's own name. */
  aka?: AltName;
}

export interface CardIndex {
  /** The card a deck-list name means, if any. */
  lookup(name: string): CardDef | undefined;
  /** The same, with the printing a name of its own belongs to. */
  find(name: string): Found | undefined;
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
  // Names from other printings, looked at only when no card has the name for its own.
  const other = new Map<string, Found>();
  for (const c of cards) {
    if (!exact.has(c.name) || commanderLegal(c)) exact.set(c.name, c);
    put(primary, normalizeName(c.name), c);
    if (c.faces.length > 1) {
      put(primary, normalizeName(c.faces[0]!.name), c);
      for (const f of c.faces.slice(1)) put(secondary, normalizeName(f.name), c);
    }
    for (const aka of c.aka ?? []) {
      const whole = normalizeName(aka.name);
      for (const key of new Set([whole, whole.split(' // ')[0]!])) if (!other.has(key) || commanderLegal(c)) other.set(key, { card: c, aka });
    }
  }
  const own = (key: string): CardDef | undefined => primary.get(key) ?? secondary.get(key);
  const find = (name: string): Found | undefined => {
    const key = normalizeName(name);
    if (!key) return undefined;
    const hit = own(key);
    if (hit) return { card: hit };
    const alias = other.get(key);
    if (alias) return alias;
    // "Fire // Ice" written with a face name we don't know as a whole: try the front face.
    const front = key.split(' // ')[0]!;
    if (front !== key) {
      const byFront = own(front);
      if (byFront) return { card: byFront };
      if (other.has(front)) return other.get(front);
    }
    // Arena's rebalanced cards are listed as "A-Name": the card itself is what's played here.
    return /^a-\S/.test(key) ? find(key.slice(2)) : undefined;
  };
  return { get: (name) => exact.get(name), find, lookup: (name) => find(name)?.card };
}

/** The printing of a card that a deck line's set code and collector number name, if it's one with a name of its own. */
export function akaByPrinting(card: CardDef, set: string | undefined, number: string | undefined): AltName | undefined {
  if (!set || !number) return undefined;
  return card.aka?.find((a) => a.set.toLowerCase() === set.toLowerCase() && a.number.toLowerCase() === number.toLowerCase());
}
