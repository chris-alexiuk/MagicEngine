import type { ActivatedAbility, FaceDef } from '@mtg/schema';
import type { GameObject, GameState, ManaColor } from './types.js';
import { faceOf } from './zones.js';

/**
 * Current characteristics of an object. For now these come straight from the
 * printed face plus counters; continuous effects and layers (rule 613) arrive in milestone 3.
 */
export function hasType(g: GameState, o: GameObject, type: string): boolean {
  return faceOf(g, o).types.includes(type);
}

export function hasKeyword(g: GameState, o: GameObject, id: string): boolean {
  return faceOf(g, o).keywords.some((k) => k.id === id);
}

export function isPermanentCard(face: FaceDef): boolean {
  return face.types.some((t) => ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].includes(t));
}

export function power(g: GameState, o: GameObject): number {
  const base = Number(faceOf(g, o).power ?? 0) || 0;
  return base + (o.counters['+1/+1'] ?? 0) - (o.counters['-1/-1'] ?? 0);
}

export function toughness(g: GameState, o: GameObject): number {
  const base = Number(faceOf(g, o).toughness ?? 0) || 0;
  return base + (o.counters['+1/+1'] ?? 0) - (o.counters['-1/-1'] ?? 0);
}

const BASIC_LAND_MANA: Record<string, ManaColor> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

function intrinsicManaAbility(color: ManaColor): ActivatedAbility {
  return {
    kind: 'activated',
    text: `{T}: Add {${color}}.`,
    cost: { tap: true },
    effects: [{ type: 'add_mana', options: [[color]] }],
    mana: true,
  };
}

/**
 * Mana abilities of a permanent, in a stable order: intrinsic basic-land-type
 * abilities first, then compiled ones.
 * CR 305.6: a land with a basic land type has the intrinsic ability "{T}: Add [mana symbol]."
 */
export function manaAbilities(g: GameState, o: GameObject): ActivatedAbility[] {
  const face = faceOf(g, o);
  const out: ActivatedAbility[] = [];
  if (face.types.includes('Land')) {
    for (const sub of face.subtypes) {
      const color = BASIC_LAND_MANA[sub];
      if (color) out.push(intrinsicManaAbility(color));
    }
  }
  for (const a of face.abilities) if (a.kind === 'activated' && a.mana) out.push(a);
  return out;
}

/**
 * CR 302.6: a creature's {T}/{Q} abilities need continuous control since the turn began;
 * CR 702.10c: haste lifts that restriction.
 */
export function canUseTapAbilities(g: GameState, o: GameObject): boolean {
  if (!hasType(g, o, 'Creature')) return true;
  return !o.sick || hasKeyword(g, o, 'haste');
}

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const TYPE_WORDS: Record<string, string> = {
  creatures: 'Creature',
  artifacts: 'Artifact',
  enchantments: 'Enchantment',
  instants: 'Instant',
  sorceries: 'Sorcery',
  planeswalkers: 'Planeswalker',
  lands: 'Land',
};

/** CR 702.16g: "protection from A and from B" is two protection abilities. */
export function protectionQualities(g: GameState, o: GameObject): string[] {
  return faceOf(g, o)
    .keywords.filter((k) => k.id === 'protection' && k.text)
    .flatMap((k) => k.text!.split(/\s*(?:,\s*)?and from\s+|,\s*from\s+/))
    .map((q) => q.trim().toLowerCase());
}

/**
 * Whether `o` has protection from `source` (CR 702.16a). Colors, multicolored/monocolored,
 * card types and creature types are understood; CR 702.16j: "everything" covers every source.
 * Qualities that need a choice ("the color of your choice") are left to players.
 */
export function hasProtectionFrom(g: GameState, o: GameObject, source: GameObject): boolean {
  const face = faceOf(g, source);
  return protectionQualities(g, o).some((q) => {
    if (q === 'everything') return true;
    if (COLOR_WORDS[q]) return face.colors.includes(COLOR_WORDS[q] as (typeof face.colors)[number]);
    if (q === 'multicolored') return face.colors.length > 1;
    if (q === 'monocolored') return face.colors.length === 1;
    if (q === 'colorless') return face.colors.length === 0;
    if (TYPE_WORDS[q]) return face.types.includes(TYPE_WORDS[q]!);
    const singular = q.replace(/(?:ies)$/, 'y').replace(/s$/, '');
    return face.subtypes.some((t) => t.toLowerCase() === singular);
  });
}
