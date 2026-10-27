import type { AbilityNode, CardDef, FaceDef } from '@mtg/schema';
import type { GameEvent, GameObject, GameState } from './types.js';

/**
 * CR 709.5: Rooms — split permanent cards with a shared type line. On the battlefield a Room has the name, mana cost
 * and rules text only of its unlocked halves (its doors); its types are the shared ones.
 */
export function isRoom(def: CardDef | undefined): boolean {
  return Boolean(def && def.layout === 'split' && def.faces.length === 2 && def.faces.every((f) => f.subtypes.includes('Room')));
}

const ROOM_FACES = new WeakMap<CardDef, Map<string, FaceDef>>();

/** The characteristics a Room permanent has with these doors unlocked. Abilities of a door remember which door. */
export function roomFace(def: CardDef, unlocked: readonly [boolean, boolean]): FaceDef {
  const key = `${unlocked[0] ? 1 : 0}${unlocked[1] ? 1 : 0}`;
  let cache = ROOM_FACES.get(def);
  if (!cache) ROOM_FACES.set(def, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const halves = def.faces.filter((_, i) => unlocked[i]);
  const tagged = (a: AbilityNode, door: number): AbilityNode => {
    const copy = structuredClone(a);
    if (copy.kind === 'triggered' && copy.trigger.type === 'unlock_door') copy.trigger = { ...copy.trigger, door };
    return copy;
  };
  const base = def.faces[0]!;
  const face: FaceDef = {
    ...base,
    name: halves.map((f) => f.name).join(' // '),
    manaCost: halves.map((f) => f.manaCost).join(''),
    colors: [...new Set(halves.flatMap((f) => f.colors))],
    oracle: halves.map((f) => f.oracle).join('\n'),
    keywords: halves.flatMap((f) => structuredClone(f.keywords)),
    abilities: def.faces.flatMap((f, i) => (unlocked[i] ? f.abilities.map((a) => tagged(a, i)) : [])),
    unparsed: halves.flatMap((f) => f.unparsed),
  };
  cache.set(key, face);
  return face;
}

/** CR 709.5h–i: give a Room an unlocked designation. */
export function unlockHalf(g: GameState, o: GameObject, half: 0 | 1, events: GameEvent[]): void {
  const u = o.unlocked;
  if (!u || u[half]) return;
  const next: [boolean, boolean] = [...u];
  next[half] = true;
  o.unlocked = next;
  events.push({ type: 'unlocked', object: o.id, half, player: o.controller, full: next[0] && next[1] });
}
