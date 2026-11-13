import { SUBTYPES, type CardDef } from '@mtg/schema';

/**
 * CR 205.3m: the creature types. The rules' list, plus the types printed on cards newer than it (Klingon, Officer,
 * Borg…): a card's own type line is authoritative for its subtypes (CR 205.3), so the engine learns them from the card
 * definitions a game is created with — as the compiler does from its pool. A type is a creature type in every game,
 * so the list only ever grows; a host that loads a saved state without `createGame` calls `learnCreatureTypes` itself.
 */
export const CREATURE_TYPES: string[] = [...SUBTYPES.creature];

const known = new Set<string>(CREATURE_TYPES);
/** Subtypes of the other card types: an "Artifact Creature — Equipment Golem" has one creature type. */
const otherKinds = new Set<string>((Object.keys(SUBTYPES) as (keyof typeof SUBTYPES)[]).filter((k) => k !== 'creature').flatMap((k) => SUBTYPES[k] as readonly string[]));
const seen = new WeakSet<object>();

export const isCreatureType = (s: string): boolean => known.has(s);

export function learnCreatureTypes(cards: Iterable<CardDef>): void {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as { typeLine?: unknown; types?: unknown; subtypes?: unknown };
    // A face: a card's own, or a token's inside one of its abilities.
    if (typeof o.typeLine === 'string' && Array.isArray(o.types) && Array.isArray(o.subtypes) && (o.types.includes('Creature') || o.types.includes('Kindred'))) {
      for (const s of o.subtypes as string[]) {
        if (known.has(s) || otherKinds.has(s)) continue;
        known.add(s);
        CREATURE_TYPES.push(s);
      }
    }
    for (const x of Object.values(v)) if (x && typeof x === 'object') visit(x);
  };
  for (const card of cards) {
    if (seen.has(card)) continue;
    seen.add(card);
    visit(card.faces);
  }
}
