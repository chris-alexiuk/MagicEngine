const SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host']);
/** Words Scryfall puts on token/emblem type lines that aren't game card types. */
const NON_TYPES = new Set(['Token', 'Card']);

export interface ParsedTypeLine {
  supertypes: string[];
  types: string[];
  subtypes: string[];
}

/**
 * "Legendary Creature — Human Druid" → { supertypes: [Legendary], types: [Creature], subtypes: [Human, Druid] }.
 * Unknown words left of the dash are kept as types, so a brand-new card type still round-trips.
 */
export function parseTypeLine(typeLine: string): ParsedTypeLine {
  const [left = '', right = ''] = typeLine.split(/\s+—\s+/, 2);
  const supertypes: string[] = [];
  const types: string[] = [];
  for (const word of left.split(/\s+/).filter(Boolean)) {
    if (SUPERTYPES.has(word)) supertypes.push(word);
    else if (!NON_TYPES.has(word)) types.push(word);
  }
  const subtypes = right ? right.split(/\s+/).filter(Boolean) : [];
  return { supertypes, types, subtypes };
}
