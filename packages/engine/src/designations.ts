import type { ConditionNode } from '@mtg/schema';
import { evalCondition } from './conditions.js';
import { chars } from './characteristics.js';
import type { GameEvent, GameObject, GameState, PlayerId } from './types.js';
import { faceOf } from './zones.js';

/**
 * Player designations checked whenever state-based actions are (CR 702.179a is one; the others aren't, but work "any
 * time"): start your engines! gives a player speed 1; a keyword that means "Any time [something is true] and you don't
 * have [a designation], you get it for the rest of the game" gives it — ascend and the city's blessing (CR 702.131b),
 * storied and an enduring story (CR 702.195a). Which keywords those are, and what has to be true, is their definition
 * in the rules as the compiler read it (a `designation` static ability): nothing here names one.
 */
export function checkDesignations(g: GameState, events: GameEvent[]): void {
  // Cheap first: only permanents printed with such a keyword can matter (granting one is vanishingly rare).
  const printed = (o: GameObject, id: string) => faceOf(g, o).keywords.some((k) => k.id === id);
  const has = (o: GameObject, id: string) => printed(o, id) && chars(g, o).keywords.some((k) => k.id === id);
  let engines: GameObject[] | null = null;
  let marking: { o: GameObject; keyword: string; name: string; condition: ConditionNode }[] | null = null;
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (printed(o, 'start_your_engines')) (engines ??= []).push(o);
    for (const k of faceOf(g, o).keywords) {
      for (const a of k.abilities ?? []) {
        if (a.kind === 'static' && a.effect.type === 'designation') (marking ??= []).push({ o, keyword: k.id, name: String(a.effect.name), condition: a.effect.condition as ConditionNode });
      }
    }
  }
  if (!engines && !marking) return;
  for (const p of g.order) {
    const ps = g.players[p]!;
    if (ps.lost) continue;
    // CR 702.179a: a player who controls a permanent with start your engines! and has no speed gets speed 1.
    if (ps.speed === undefined && engines?.some((o) => o.controller === p && has(o, 'start_your_engines'))) {
      ps.speed = 1;
      events.push({ type: 'speed', player: p, speed: 1 });
    }
    for (const m of marking ?? []) {
      if (m.o.controller !== p || ps.designations?.[m.name] || !has(m.o, m.keyword)) continue;
      if (evalCondition(m.condition, { g, controller: p, source: m.o, events: [], targets: [], x: 0, memo: {} })) giveDesignation(g, p, m.name, events);
    }
  }
}

/** The player gets a designation that is only a marker ("the city's blessing"), for the rest of the game. */
export function giveDesignation(g: GameState, p: PlayerId, name: string, events: GameEvent[]): void {
  const ps = g.players[p]!;
  if (ps.designations?.[name]) return;
  ps.designations = { ...(ps.designations ?? {}), [name]: true };
  events.push({ type: 'designation', player: p, name });
}
