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
