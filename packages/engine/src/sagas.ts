import type { FaceDef } from '@mtg/schema';
import type { GameEvent, GameObject, GameState } from './types.js';
import { faceOf } from './zones.js';

/**
 * Sagas (CR 714): lore counters as it enters and at each precombat main phase; chapter abilities
 * trigger as the count passes their number; the Saga is sacrificed after its final chapter.
 */

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

/** CR 714.2d: the greatest chapter number among its chapter abilities (read from the printed text). */
export function finalChapter(face: FaceDef): number {
  if (!face.subtypes.includes('Saga')) return 0;
  let n = 0;
  for (const m of face.oracle.matchAll(/^((?:I|II|III|IV|V|VI|VII)(?:, (?:I|II|III|IV|V|VI|VII))*) —/gm)) {
    for (const r of m[1]!.split(', ')) n = Math.max(n, ROMAN[r] ?? 0);
  }
  return n;
}

/** CR 714.3a / 714.3c: put a lore counter on a Saga (which can trigger its chapter abilities). */
export function addLore(g: GameState, o: GameObject, events: GameEvent[]): void {
  if (!finalChapter(faceOf(g, o))) return;
  o.counters.lore = (o.counters.lore ?? 0) + 1;
  events.push({ type: 'counters', object: o.id, counter: 'lore', delta: 1 });
}

/** CR 714.4: a Saga past its final chapter, with no chapter ability waiting, is sacrificed. */
export function sagaDone(g: GameState, o: GameObject): boolean {
  const final = finalChapter(faceOf(g, o));
  if (!final || (o.counters.lore ?? 0) < final) return false;
  const waiting =
    g.triggers.some((t) => t.source.id === o.id && t.source.zcc === o.zcc && t.ability.trigger.type === 'chapter') ||
    g.stack.some((e) => e.kind === 'ability' && e.source.id === o.id && e.source.zcc === o.zcc && e.trigger !== undefined);
  return !waiting;
}
