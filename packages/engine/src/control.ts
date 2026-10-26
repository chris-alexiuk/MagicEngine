import type { ContinuousEffectNode, StaticAbility } from '@mtg/schema';
import { objectAbilities, staticConditionHolds } from './characteristics.js';
import { removeFromCombat } from './permanents.js';
import type { GameEvent, GameState, PlayerId } from './types.js';
import { faceOf } from './zones.js';

/**
 * Layer 2 (CR 613.1b): control-changing effects. A permanent's controller is the player
 * it entered under (CR 110.2), then each control effect in timestamp order (CR 613.7):
 * static ones like "You control enchanted creature", and resolved ones like
 * "Gain control of target creature until end of turn". The result is written to
 * `controller` so the rest of the engine reads it directly.
 */
export function applyControlEffects(g: GameState, events: GameEvent[]): void {
  const changes: { timestamp: number; object: string; zcc: number; to: PlayerId }[] = [];
  for (const id of g.zones.battlefield) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'continuous') continue;
      const e = (a as StaticAbility).effect as ContinuousEffectNode;
      if (e.control !== 'you' || e.affected.ref !== 'attached' || !source.attachedTo || !staticConditionHolds(g, e, source)) continue;
      changes.push({ timestamp: source.timestamp, object: source.attachedTo.id, zcc: source.attachedTo.zcc, to: source.controller });
    }
  }
  for (const e of g.effects) {
    if (!e.control) continue;
    for (const r of e.objects) changes.push({ timestamp: e.timestamp, object: r.id, zcc: r.zcc, to: e.control });
  }
  changes.sort((a, b) => a.timestamp - b.timestamp);

  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    let controller = o.baseController ?? o.controller;
    for (const c of changes) if (c.object === id && c.zcc === o.zcc) controller = c.to;
    if (controller === o.controller || g.players[controller]?.lost) continue;
    o.controller = controller;
    // CR 302.6: it hasn't been under its new controller's control since their turn began.
    o.sick = true;
    // CR 506.4: a permanent whose controller changes is removed from combat.
    removeFromCombat(g, id);
    events.push({ type: 'control_changed', object: id, controller });
  }
}
