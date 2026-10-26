import type { FaceDef } from '@mtg/schema';
import { RulesError, type GameEvent, type GameObject, type GameState, type ObjectId, type PlayerId, type ZoneName } from './types.js';
import { onEnterBattlefield } from './registry.js';

export function obj(g: GameState, id: ObjectId): GameObject {
  const o = g.objects[id];
  if (!o) throw new RulesError(`no such object ${id}`);
  return o;
}

export function faceOf(g: GameState, o: GameObject): FaceDef {
  const def = g.cards[o.card];
  if (!def) throw new RulesError(`no card definition for ${o.card}`);
  return def.faces[o.face] ?? def.faces[0]!;
}

export function nameOf(g: GameState, o: GameObject): string {
  return faceOf(g, o).name;
}

/** The array holding a zone's contents. Player zones resolve to the owner's (CR 400.3). */
export function zoneList(g: GameState, zone: ZoneName, owner: PlayerId): ObjectId[] {
  switch (zone) {
    case 'library':
    case 'hand':
    case 'graveyard':
      return (g.zones[zone][owner] ??= []);
    case 'battlefield':
    case 'exile':
    case 'command':
      return g.zones[zone];
    case 'stack':
      throw new RulesError('the stack holds entries, not a plain object list');
  }
}

export function livePlayers(g: GameState): PlayerId[] {
  return g.order.filter((p) => !g.players[p]!.lost);
}

/** Next player in turn order who is still in the game. */
export function nextPlayer(g: GameState, after: PlayerId): PlayerId {
  const live = livePlayers(g);
  const idx = g.order.indexOf(after);
  for (let i = 1; i <= g.order.length; i++) {
    const p = g.order[(idx + i) % g.order.length]!;
    if (live.includes(p)) return p;
  }
  return after;
}

function removeFromCurrentZone(g: GameState, o: GameObject): void {
  if (o.zone === 'stack') {
    g.stack = g.stack.filter((e) => !(e.kind === 'spell' && e.object === o.id));
    return;
  }
  const list = zoneList(g, o.zone, o.owner);
  const i = list.indexOf(o.id);
  if (i >= 0) list.splice(i, 1);
}

/**
 * Moves an object to another zone.
 * CR 400.7: it becomes a new object — zone-specific state is reset and its zone-change count increases.
 * CR 400.3: cards always go to their owner's library, hand or graveyard.
 */
export function moveObject(
  g: GameState,
  id: ObjectId,
  to: ZoneName,
  events: GameEvent[],
  opts: { position?: 'top' | 'bottom'; controller?: PlayerId; face?: number; x?: number; counters?: Record<string, number> } = {},
): void {
  const o = obj(g, id);
  const from = o.zone;
  // CR 614.1a: "exile it instead" replaces the move — flashback (CR 702.34a), "if it would die this turn",
  // and "if ~ would be put into a graveyard from anywhere".
  if (from === 'stack' && o.exileOnLeave) to = 'exile';
  if (to === 'graveyard' && from === 'battlefield' && o.exileIfDiesTurn === g.turn) to = 'exile';
  if (to === 'graveyard' && hasStaticTag(g, o, 'graveyard_to_exile')) to = 'exile';
  delete o.exileOnLeave;
  const controllerBefore = o.controller;
  const countersBefore = from === 'battlefield' ? { ...o.counters } : undefined;
  const castInfo = from === 'stack' && to === 'battlefield' ? o.cast : undefined;
  const faceBefore = o.face;
  removeFromCurrentZone(g, o);

  o.zone = to;
  o.zcc++;
  o.tapped = false;
  o.damage = 0;
  o.counters = {};
  o.sick = to === 'battlefield';
  // CR 613.7d: an object receives a timestamp as it enters a zone.
  o.timestamp = ++g.clock;
  delete o.loyaltyActivatedTurn;
  delete o.attachedTo;
  delete o.regenShields;
  delete o.activatedTurn;
  delete o.triggeredTurn;
  delete o.monstrous;
  delete o.chosen;
  delete o.exileIfDiesTurn;
  delete o.baseController;
  if (opts.x !== undefined) o.x = opts.x;
  else delete o.x;
  if (castInfo) o.cast = castInfo;
  else delete o.cast;
  o.controller = to === 'battlefield' || to === 'stack' ? (opts.controller ?? o.controller) : o.owner;
  o.face = opts.face ?? (to === 'battlefield' || to === 'stack' ? o.face : 0);

  if (to !== 'stack') {
    const list = zoneList(g, to, o.owner);
    // Libraries are top-first; graveyards and other zones append (last = most recent / top).
    if (to === 'library') {
      if (opts.position === 'bottom') list.push(id);
      else list.unshift(id);
    } else list.push(id);
  }
  if (to === 'battlefield') {
    // CR 110.2: it's controlled by the player under whose control it entered.
    o.baseController = o.controller;
    // CR 122.6: "returns … with a -1/-1 counter on it" — it enters with them.
    for (const [counter, n] of Object.entries(opts.counters ?? {})) o.counters[counter] = (o.counters[counter] ?? 0) + n;
    const face = faceOf(g, o);
    // CR 306.5b: a planeswalker enters with loyalty counters equal to its printed loyalty.
    if (face.loyalty !== undefined && /^\d+$/.test(face.loyalty)) o.counters.loyalty = Number(face.loyalty);
    // CR 310.4b: a battle enters with defense counters equal to its printed defense.
    if (face.defense !== undefined && /^\d+$/.test(face.defense)) o.counters.defense = Number(face.defense);
    onEnterBattlefield(g, o, events);
  }
  events.push({
    type: 'moved',
    object: id,
    from,
    to,
    controller: controllerBefore,
    card: o.card,
    face: from === 'battlefield' || from === 'stack' ? faceBefore : o.face,
    ...(o.token ? { token: true as const } : {}),
    ...(countersBefore ? { counters: countersBefore } : {}),
  });
}

/** Creates a fresh object for a card owned by `owner`, placed in `zone`. */
export function createObject(g: GameState, card: string, owner: PlayerId, zone: Exclude<ZoneName, 'stack'>): GameObject {
  const id = `o${g.nextId++}`;
  const o: GameObject = {
    id,
    card,
    owner,
    controller: owner,
    zone,
    zcc: 0,
    face: 0,
    tapped: false,
    sick: zone === 'battlefield',
    damage: 0,
    counters: {},
    timestamp: ++g.clock,
    ...(zone === 'battlefield' ? { baseController: owner } : {}),
  };
  g.objects[id] = o;
  zoneList(g, zone, owner).push(id);
  return o;
}

/** Draws one card. CR 704.5b / 104.3c: drawing from an empty library is recorded for state-based actions. */
export function drawCard(g: GameState, player: PlayerId, events: GameEvent[]): void {
  const library = zoneList(g, 'library', player);
  const top = library[0];
  if (!top) {
    g.players[player]!.drewFromEmptyLibrary = true;
    return;
  }
  moveObject(g, top, 'hand', events);
  events.push({ type: 'drew', player, object: top });
}

/** Whether the object's printed abilities (or its keywords') include a static ability with this tag. */
function hasStaticTag(g: GameState, o: GameObject, tag: string): boolean {
  const face = faceOf(g, o);
  return [...face.abilities, ...face.keywords.flatMap((k) => k.abilities ?? [])].some((a) => a.kind === 'static' && a.effect.type === tag);
}

export function setTapped(g: GameState, id: ObjectId, tapped: boolean, events: GameEvent[]): void {
  const o = obj(g, id);
  if (o.tapped === tapped) return;
  o.tapped = tapped;
  events.push({ type: 'tapped', object: id, tapped });
}
