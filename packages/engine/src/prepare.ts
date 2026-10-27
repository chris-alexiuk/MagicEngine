import type { GameEvent, GameObject, GameState, PlayerId } from './types.js';
import { createObject } from './zones.js';

/**
 * Preparation cards (CR 722). A permanent with a prepare spell can become prepared; as it does, its
 * controller creates a copy of the prepare spell in exile, which they may cast while the permanent stays
 * prepared (CR 722.3c). Casting the copy unprepares the permanent.
 */

/** CR 722.2a: it has a prepare spell (the card's second set of characteristics). */
export function hasPrepareSpell(g: GameState, o: GameObject): boolean {
  const def = g.cards[o.copyOf?.card ?? o.card];
  return def?.layout === 'prepare' && def.faces.length > 1 && !o.faceDown;
}

/** CR 722.3a / 722.3c: it becomes prepared — unless it can't, or already is. */
export function becomePrepared(g: GameState, o: GameObject, events: GameEvent[]): void {
  if (o.zone !== 'battlefield' || o.prepared || !hasPrepareSpell(g, o)) return;
  o.prepared = true;
  const copy = createObject(g, o.copyOf?.card ?? o.card, o.controller, 'exile');
  copy.face = 1;
  copy.prepareOf = { id: o.id, zcc: o.zcc };
  events.push({ type: 'prepared', object: o.id, prepared: true });
}

/** CR 722.3b: it becomes unprepared; the copy in exile goes away (CR 722.3c). */
export function unprepare(g: GameState, o: GameObject, events: GameEvent[]): void {
  if (!o.prepared) return;
  delete o.prepared;
  for (const id of [...g.zones.exile]) {
    const copy = g.objects[id];
    if (copy?.prepareOf?.id === o.id) {
      g.zones.exile = g.zones.exile.filter((x) => x !== id);
      delete g.objects[id];
    }
  }
  events.push({ type: 'prepared', object: o.id, prepared: false });
}

/** The prepared permanent a prepare-spell copy in exile belongs to, while it's still prepared (and `player` controls it). */
export function preparedSource(g: GameState, copy: GameObject, player?: PlayerId): GameObject | undefined {
  const r = copy.prepareOf;
  const o = r ? g.objects[r.id] : undefined;
  if (!o || !r || o.zcc !== r.zcc || o.zone !== 'battlefield' || !o.prepared) return undefined;
  if (player !== undefined && o.controller !== player) return undefined;
  return o;
}
