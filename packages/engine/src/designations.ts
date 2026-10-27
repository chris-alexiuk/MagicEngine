import type { GameEvent, GameObject, GameState, PlayerId } from './types.js';
import { chars } from './characteristics.js';
import { faceOf } from './zones.js';

/**
 * Player designations checked whenever state-based actions are (CR 702.179a is one; CR 702.131b isn't,
 * but works "any time"): start your engines! gives a player speed 1; ascend gives the city's blessing.
 */
export function checkDesignations(g: GameState, events: GameEvent[]): void {
  // Cheap first: only permanents printed with these keywords can matter (granting them is vanishingly rare).
  const printed = (o: GameObject, id: string) => faceOf(g, o).keywords.some((k) => k.id === id);
  const has = (o: GameObject, id: string) => printed(o, id) && chars(g, o).keywords.some((k) => k.id === id);
  let engines: GameObject[] | null = null;
  let ascend: GameObject[] | null = null;
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (printed(o, 'start_your_engines')) (engines ??= []).push(o);
    if (printed(o, 'ascend')) (ascend ??= []).push(o);
  }
  if (!engines && !ascend) return;
  for (const p of g.order) {
    const ps = g.players[p]!;
    if (ps.lost) continue;
    // CR 702.179a: a player who controls a permanent with start your engines! and has no speed gets speed 1.
    if (ps.speed === undefined && engines?.some((o) => o.controller === p && has(o, 'start_your_engines'))) {
      ps.speed = 1;
      events.push({ type: 'speed', player: p, speed: 1 });
    }
    // CR 702.131b: ten or more permanents and a permanent with ascend.
    if (!ps.cityBlessing && ascend?.some((o) => o.controller === p && has(o, 'ascend'))) {
      if (g.zones.battlefield.filter((id) => g.objects[id]!.controller === p).length >= 10) giveCityBlessing(g, p, events);
    }
  }
}

export function giveCityBlessing(g: GameState, p: PlayerId, events: GameEvent[]): void {
  const ps = g.players[p]!;
  if (ps.cityBlessing) return;
  ps.cityBlessing = true;
  events.push({ type: 'city_blessing', player: p });
}

/** CR 702.131a: an ascend spell — checked as it resolves. */
export function ascendOnResolve(g: GameState, p: PlayerId, events: GameEvent[]): void {
  if (g.zones.battlefield.filter((id) => g.objects[id]!.controller === p).length >= 10) giveCityBlessing(g, p, events);
}
