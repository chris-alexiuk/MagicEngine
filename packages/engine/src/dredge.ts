import type { GameEvent, GameState, ObjectId, PlayerId } from './types.js';
import { drawCard, faceOf, moveObject, zoneList } from './zones.js';

/**
 * CR 702.52a: "Dredge N" — "As long as you have at least N cards in your library, if you would draw a card, you may
 * instead mill N cards and return this card from your graveyard to your hand." (CR 702.52b: not with fewer.)
 */
export function dredgeOptions(g: GameState, player: PlayerId): ObjectId[] {
  const library = zoneList(g, 'library', player).length;
  return zoneList(g, 'graveyard', player).filter((id) => {
    const n = faceOf(g, g.objects[id]!).keywords.find((k) => k.id === 'dredge')?.n;
    return n !== undefined && library >= n;
  });
}

/** One draw, or the dredge chosen instead of it. */
export function drawOrDredge(g: GameState, player: PlayerId, dredge: ObjectId | null, events: GameEvent[]): void {
  if (!dredge) {
    drawCard(g, player, events);
    return;
  }
  const o = g.objects[dredge]!;
  const n = faceOf(g, o).keywords.find((k) => k.id === 'dredge')!.n!;
  for (const id of zoneList(g, 'library', player).slice(0, n)) moveObject(g, id, 'graveyard', events);
  moveObject(g, dredge, 'hand', events);
}
