/**
 * Whether a spell's targets are what an ability's description of them is about (schema `TargetsFilter`): "a spell that
 * targets a creature you control", "… that targets you or a permanent you control", "… that targets this creature" —
 * one of its targets is such a one, as they were chosen while it was cast (CR 601.2c). One reading for every ability
 * that names a spell by what it targets — a trigger on casting it, what it costs, whether it may be cast as though it
 * had flash — from the point of view of the object with the ability (`holder`) and its controller.
 */
import type { TargetsFilter } from '@mtg/schema';
import { matchesFilter } from './characteristics.js';
import type { GameObject, GameState, PlayerId, TargetRef } from './types.js';

/** Whether this one target is such a one. */
export function fitsTarget(g: GameState, spec: TargetsFilter, target: TargetRef, controller: PlayerId, holder: GameObject): boolean {
  if (target.kind === 'player') return Boolean(spec.you && target.player === controller);
  if (target.kind !== 'object' || !spec.objects) return false;
  const o = g.objects[target.id];
  // "that target a creature": a creature permanent, not a creature card elsewhere (a filter that names a zone checks that
  // one); and the object the target was chosen as (CR 400.7).
  return Boolean(o && o.zcc === target.zcc && matchesFilter(g, o, spec.objects, { controller, source: holder }));
}

/** Whether any of the chosen targets is. */
export function fitsTargets(g: GameState, spec: TargetsFilter, targets: readonly (readonly TargetRef[])[] | undefined, controller: PlayerId, holder: GameObject): boolean {
  return (targets ?? []).some((list) => list.some((t) => fitsTarget(g, spec, t, controller, holder)));
}
