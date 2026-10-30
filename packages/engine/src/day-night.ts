import type { GameEvent, GameObject, GameState } from './types.js';
import { faceOf } from './zones.js';
import { hasRule } from './characteristics.js';

/**
 * Day and night (CR 731, CR 702.145). The game has neither until something makes it day or night;
 * from then on it changes as each turn's untap step checks the previous turn's spells (CR 502.2).
 * Daybound permanents are night-side down by day and transform as it becomes night; nightbound
 * ones transform back as it becomes day. They can't transform any other way (CR 702.145b/e).
 */

const has = (g: GameState, o: GameObject, id: 'daybound' | 'nightbound') => faceOf(g, o).keywords.some((k) => k.id === id);

/** Whether a card has daybound or nightbound on either face (so other effects can't transform it). */
export function dayNightCard(g: GameState, o: GameObject): boolean {
  return Boolean(g.cards[o.card]?.faces.some((f) => f.keywords.some((k) => k.id === 'daybound' || k.id === 'nightbound')));
}

/** CR 702.145c/f: daybound permanents face up at night, nightbound ones at day, transform — immediately. */
function transformBound(g: GameState, events: GameEvent[]): void {
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    const def = g.cards[o.card];
    if (!def || def.faces.length !== 2 || o.faceDown) continue;
    if (((g.dayNight === 'night' && o.face === 0 && has(g, o, 'daybound')) || (g.dayNight === 'day' && o.face === 1 && has(g, o, 'nightbound'))) && !hasRule(g, o, 'cant_transform')) {
      o.face = o.face === 0 ? 1 : 0;
      events.push({ type: 'transformed', object: o.id, face: o.face });
    }
  }
}

/** CR 731.1: it becomes day or night; as it does, daybound and nightbound permanents transform (CR 702.145b, e). */
export function setDayNight(g: GameState, to: 'day' | 'night', events: GameEvent[]): void {
  if (g.dayNight === to) return;
  const from = g.dayNight;
  g.dayNight = to;
  events.push({ type: 'day_night', to, ...(from ? { from } : {}) });
  transformBound(g, events);
}

/** CR 502.2 / 731.2: at the untap step, check how many spells the previous turn's active player cast. */
export function checkDayNight(g: GameState, previous: number | undefined, events: GameEvent[]): void {
  // CR 731.2c: if it's neither, the check doesn't happen.
  if (!g.dayNight || previous === undefined) return;
  if (g.dayNight === 'day' && previous === 0) setDayNight(g, 'night', events);
  else if (g.dayNight === 'night' && previous >= 2) setDayNight(g, 'day', events);
}

/**
 * Checked whenever the game checks state-based actions (though these aren't any): CR 702.145d/g —
 * a daybound permanent makes it day if it's neither (a nightbound one, night, if no daybound one is
 * around); CR 702.145c/f — mismatched daybound/nightbound permanents transform.
 */
export function syncDayNight(g: GameState, events: GameEvent[]): void {
  if (!g.dayNight) {
    const bound = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => !o.faceDown);
    if (bound.some((o) => has(g, o, 'daybound'))) setDayNight(g, 'day', events);
    else if (bound.some((o) => has(g, o, 'nightbound'))) setDayNight(g, 'night', events);
    return;
  }
  transformBound(g, events);
}
