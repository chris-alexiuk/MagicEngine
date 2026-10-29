import type { CardDef, FaceDef, KeywordInstance } from '@mtg/schema';
import type { GameObject, GameState } from './types.js';

/**
 * Face-down spells and permanents (CR 708). Morph and disguise cast a card face down for {3}
 * (CR 702.37a, 702.168a); manifest and cloak put the top card of a library onto the battlefield
 * face down (CR 701.40a, 701.58a). Face down it's a 2/2 creature with no name, text, subtypes or
 * mana cost — with ward {2} for disguise and cloak (CR 708.2) — and only its controller may look
 * at it (CR 708.5). It keeps its own card, so it can be turned face up again (CR 708.8).
 */

export type FaceDownKind = 'morph' | 'disguise' | 'manifest' | 'cloak';

/** Ward {2}: what "Ward {2}" compiles to from CR 702.21a. */
const WARD_2: KeywordInstance = {
  id: 'ward',
  cost: '{2}',
  abilities: [
    {
      kind: 'triggered',
      text: 'Ward {2}',
      trigger: { type: 'becomes_target', subject: { ref: 'self' }, by: 'opponent' },
      effects: [{ type: 'unless_pays', payer: { ref: 'trigger_player' }, cost: '{2}', effects: [{ type: 'counter', what: { ref: 'trigger_object' } }] }],
    },
  ],
};

function face(ward: boolean): FaceDef {
  return {
    name: '',
    manaCost: '',
    typeLine: 'Creature',
    supertypes: [],
    types: ['Creature'],
    subtypes: [],
    oracle: ward ? 'Ward {2}' : '',
    power: '2',
    toughness: '2',
    colors: [],
    keywords: ward ? [WARD_2] : [],
    abilities: [],
    unparsed: [],
  };
}

export const FACE_DOWN = 'face-down';
export const FACE_DOWN_WARD = 'face-down-ward';

const DEFS: Record<string, CardDef> = Object.fromEntries(
  [FACE_DOWN, FACE_DOWN_WARD].map((key) => [
    key,
    { id: key, name: '', layout: 'normal', cmc: 0, colorIdentity: [], faces: [face(key === FACE_DOWN_WARD)], legal: {}, set: '', rarity: '', automation: 'full' } as CardDef,
  ]),
);

/** Which face-down kind a face-down face stands for (its ward), or undefined for any other face. */
export function faceDownKindOf(f: FaceDef): 'morph' | 'disguise' | undefined {
  return f === DEFS[FACE_DOWN]!.faces[0] ? 'morph' : f === DEFS[FACE_DOWN_WARD]!.faces[0] ? 'disguise' : undefined;
}

/** The card definition standing for a face-down object's characteristics. */
export function faceDownKey(o: GameObject): string {
  return o.faceDown === 'disguise' || o.faceDown === 'cloak' ? FACE_DOWN_WARD : FACE_DOWN;
}

export function faceDownFace(o: GameObject): FaceDef {
  return DEFS[faceDownKey(o)]!.faces[0]!;
}

export function faceDownDef(key: string): CardDef | undefined {
  return DEFS[key];
}

/** Makes the face-down definitions available by key (for copies of face-down permanents, and views). */
export function ensureFaceDownDefs(g: GameState): void {
  for (const [key, def] of Object.entries(DEFS)) g.cards[key] ??= def;
}

/** The keywords that let a card be cast face down. */
export const FACE_DOWN_KEYWORDS = ['morph', 'megamorph', 'disguise'] as const;
