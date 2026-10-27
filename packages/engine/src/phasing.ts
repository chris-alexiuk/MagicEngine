import { hasKeyword } from './characteristics.js';
import { removeFromCombat } from './permanents.js';
import type { GameEvent, GameObject, GameState } from './types.js';

/**
 * CR 702.26: phasing. A phased-out permanent is treated as though it doesn't exist (CR 702.26b) — it stays on the
 * battlefield (phasing isn't a zone change, CR 702.26d) but leaves the battlefield's list until it phases in.
 * Whatever is attached to it phases out with it, indirectly (CR 702.26g).
 */
export function phaseOut(g: GameState, o: GameObject, events: GameEvent[], indirectly = false): void {
  const i = g.zones.battlefield.indexOf(o.id);
  if (i < 0) return;
  g.zones.battlefield.splice(i, 1);
  (g.phasedOut ??= []).push(o.id);
  o.phasedOut = indirectly ? 'indirectly' : 'directly';
  // CR 506.4: a permanent that phases out is removed from combat.
  removeFromCombat(g, o.id);
  events.push({ type: 'phased', object: o.id, out: true });
  for (const id of [...g.zones.battlefield]) {
    const x = g.objects[id]!;
    if (x.attachedTo?.id === o.id) phaseOut(g, x, events, true);
  }
}

function phaseIn(g: GameState, o: GameObject, events: GameEvent[]): void {
  g.phasedOut = (g.phasedOut ?? []).filter((id) => id !== o.id);
  delete o.phasedOut;
  g.zones.battlefield.push(o.id);
  events.push({ type: 'phased', object: o.id, out: false });
}

/**
 * CR 502.1: as the untap step begins, the active player's permanents with phasing phase out, and what they controlled
 * that phased out phases in (what phased out indirectly comes back with what it's attached to). All at once.
 */
export function phasingStep(g: GameState, events: GameEvent[]): void {
  const goingOut = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.controller === g.active && hasKeyword(g, o, 'phasing'));
  const comingIn = (g.phasedOut ?? []).map((id) => g.objects[id]!).filter((o) => o && o.controller === g.active);
  for (const o of comingIn) phaseIn(g, o, events);
  for (const o of goingOut) if (g.zones.battlefield.includes(o.id)) phaseOut(g, o, events);
}
