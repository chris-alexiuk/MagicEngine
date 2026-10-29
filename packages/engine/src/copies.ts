import { SUBTYPES, type CardDef, type CopyExcept, type FaceDef } from '@mtg/schema';
import { faceDownKey } from './face-down.js';
import type { GameObject, GameState } from './types.js';

/**
 * Copy effects (CR 707). A copy takes the copiable values of the original (CR 707.2): what's
 * printed on it, as modified by other copy effects and by the exceptions of this one
 * (CR 707.9) — nothing else. That's layer 1 (CR 613.2a).
 *
 * An object that has become a copy keeps its own card (it's still Clone in your graveyard
 * later); `copyOf` names the card definition whose face it now has. Copies with exceptions
 * get a card definition of their own, keyed by its contents.
 */

export interface CopyRef {
  card: string;
  face: number;
}

/** CR 707.2: what a copy of this object copies. */
export function copiable(o: GameObject): CopyRef {
  // CR 708.2: a face-down permanent's copiable values are the face-down ones.
  if (o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack')) return { card: faceDownKey(o), face: 0 };
  return o.copyOf ? { ...o.copyOf } : { card: o.card, face: o.face };
}

const CREATURE_TYPES = new Set<string>(SUBTYPES.creature);

function typeLine(face: FaceDef): string {
  const left = [...face.supertypes, ...face.types].join(' ');
  return face.subtypes.length ? `${left} — ${face.subtypes.join(' ')}` : left;
}

function applyExcept(face: FaceDef, x: CopyExcept): FaceDef {
  const f = structuredClone(face);
  if (x.name) f.name = x.name;
  if (x.nonlegendary) f.supertypes = f.supertypes.filter((s) => s !== 'Legendary');
  for (const s of x.supertypes ?? []) if (!f.supertypes.includes(s)) f.supertypes.push(s);
  // CR 205.1a / 205.3d: "it's an artifact" — its card types are replaced, and subtypes of the types it lost go with them.
  if (x.setTypes) {
    f.types = [...x.setTypes];
    const allowed = new Set(x.setTypes.flatMap((t) => SUBTYPES[t.toLowerCase() as keyof typeof SUBTYPES] ?? []));
    if (x.setTypes.some((t) => t === 'Instant' || t === 'Sorcery')) for (const s of SUBTYPES.spell) allowed.add(s);
    f.subtypes = f.subtypes.filter((s) => allowed.has(s));
  }
  for (const t of x.addTypes ?? []) if (!f.types.includes(t)) f.types.push(t);
  if (x.setCreatureTypes) f.subtypes = [...f.subtypes.filter((s) => !CREATURE_TYPES.has(s)), ...x.setCreatureTypes];
  for (const s of x.addSubtypes ?? []) if (!f.subtypes.includes(s)) f.subtypes.push(s);
  if (x.colors) f.colors = [...x.colors];
  if (x.addColors) f.colors = (['W', 'U', 'B', 'R', 'G'] as const).filter((c) => f.colors.includes(c) || x.addColors!.includes(c));
  if (x.power !== undefined) f.power = String(x.power);
  if (x.toughness !== undefined) f.toughness = String(x.toughness);
  if (x.loyalty !== undefined) f.loyalty = String(x.loyalty);
  // A quoted ability ('it has "{T}: Add {U}."') is printed on the copy — one of its own abilities, mana abilities too.
  for (const k of structuredClone(x.keywords ?? [])) {
    if (k.id === 'ability' && k.abilities) f.abilities.push(...k.abilities.map((a) => ({ ...a, text: a.text ?? k.text })));
    else f.keywords.push(k);
  }
  // "except it has this ability"
  if (x.abilities) for (const a of x.abilities) if (!f.abilities.some((b) => b.text === a.text)) f.abilities.push(structuredClone(a));
  // CR 202.3a: with no mana cost its mana value is 0.
  if (x.noManaCost) f.manaCost = '';
  f.typeLine = typeLine(f);
  return f;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The copiable values of `base` with this copy effect's exceptions (CR 707.9b). */
export function withExceptions(g: GameState, base: CopyRef, except: CopyExcept | undefined): CopyRef {
  if (!except || !Object.keys(except).length) return base;
  const def = g.cards[base.card];
  if (!def) return base;
  const face = applyExcept(def.faces[base.face] ?? def.faces[0]!, except);
  const key = `copy:${base.card}:${base.face}:${hash(JSON.stringify(except))}`;
  if (!g.cards[key]) {
    const copy: CardDef = { ...def, id: key, name: face.name, layout: 'normal', cmc: except.noManaCost ? 0 : def.cmc, faces: [face], legal: {} };
    g.cards[key] = copy;
  }
  return { card: key, face: 0 };
}
