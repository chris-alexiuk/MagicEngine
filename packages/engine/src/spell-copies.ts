import type { GameEvent, GameObject, GameState, ObjectId, PlayerId, StackEntry } from './types.js';

/**
 * CR 707.10: to copy a spell is to put a copy of it onto the stack. The copy isn't cast; it has
 * the original's characteristics and the choices made for it (modes, X, kicker, targets), and its
 * controller is whoever copied it. It ceases to exist once it leaves the stack (CR 704.5e); a copy
 * of a permanent spell becomes a token as it resolves (CR 608.3f).
 */
export function copySpell(g: GameState, entry: StackEntry & { kind: 'spell' }, controller: PlayerId, events: GameEvent[]): ObjectId {
  const orig = g.objects[entry.object]!;
  const id = `o${g.nextId++}`;
  const o: GameObject = {
    id,
    card: orig.card,
    owner: controller,
    controller,
    zone: 'stack',
    zcc: 0,
    face: orig.face,
    tapped: false,
    sick: false,
    damage: 0,
    counters: {},
    timestamp: ++g.clock,
    spellCopy: true,
    ...(orig.copyOf ? { copyOf: { ...orig.copyOf } } : {}),
    cast: { by: controller, from: 'stack', copy: true, ...(orig.cast?.kicked ? { kicked: true as const } : {}) },
  };
  g.objects[id] = o;
  g.stack.push({ ...structuredClone(entry), object: id, controller });
  events.push({ type: 'copied', object: id, of: orig.id, controller });
  return id;
}
