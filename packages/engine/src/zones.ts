import { faceDownFace } from './face-down.js';
import type { ExileInsteadNode, FaceDef } from '@mtg/schema';
import { RulesError, type GameEvent, type GameObject, type GameState, type ObjectId, type PlayerId, type ZoneName } from './types.js';
import { onEnterBattlefield } from './registry.js';
import { chars, matchesFilter, objectAbilities } from './characteristics.js';
import { addLore } from './sagas.js';

export function obj(g: GameState, id: ObjectId): GameObject {
  const o = g.objects[id];
  if (!o) throw new RulesError(`no such object ${id}`);
  return o;
}

export function faceOf(g: GameState, o: GameObject): FaceDef {
  // CR 708.2: face down on the battlefield or the stack, it has only the face-down characteristics.
  if (o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack')) return faceDownFace(o);
  // CR 707.2 / 613.2a: a copy has the copiable values of what it copies (layer 1).
  const at = o.copyOf ?? o;
  const def = g.cards[at.card];
  if (!def) throw new RulesError(`no card definition for ${at.card}`);
  return def.faces[at.face] ?? def.faces[0]!;
}

/**
 * Where static and triggered abilities come from: permanents on the battlefield, and emblems
 * in the command zone (CR 114.4: an emblem's abilities function there).
 */
export function abilitySources(g: GameState): ObjectId[] {
  const emblems = g.zones.command.filter((id) => g.objects[id]?.emblem);
  return emblems.length ? [...g.zones.battlefield, ...emblems] : g.zones.battlefield;
}

/** CR 202.3: mana value, from the mana cost it has (a copy's is the original's, CR 707.2). */
export function manaValueOf(g: GameState, o: GameObject): number {
  if (o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack')) return 0; // CR 708.2: no mana cost
  return g.cards[(o.copyOf ?? o).card]?.cmc ?? 0;
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
  opts: { position?: 'top' | 'bottom'; controller?: PlayerId; face?: number; x?: number; counters?: Record<string, number>; faceDown?: GameObject['faceDown']; tapped?: boolean } = {},
): void {
  const o = obj(g, id);
  const from = o.zone;
  // CR 614.1a: "exile it instead" replaces the move — flashback (CR 702.34a), "if it would die this turn",
  // and "if ~ would be put into a graveyard from anywhere".
  if (from === 'stack' && o.exileOnLeave) to = 'exile';
  if (from === 'battlefield' && o.exileWhenLeaves) to = 'exile';
  if (to === 'graveyard' && from === 'battlefield' && o.exileIfDiesTurn === g.turn) to = 'exile';
  if (to === 'graveyard' && hasStaticTag(g, o, 'graveyard_to_exile')) to = 'exile';
  if (to === 'graveyard' && exiledInstead(g, o, from)) to = 'exile';
  delete o.exileOnLeave;
  const controllerBefore = o.controller;
  const countersBefore = from === 'battlefield' ? { ...o.counters } : undefined;
  if (from === 'battlefield') {
    // CR 608.2h: remember how it last existed on the battlefield ("deals damage equal to its power").
    const c = chars(g, o);
    // CR 603.10a: triggered abilities it was granted ("have "When this creature dies, …"") look back too.
    const printedKws = faceOf(g, o).keywords;
    const granted = c.keywords.filter((k) => !printedKws.includes(k)).flatMap((k) => (k.abilities ?? []).filter((a) => a.kind === 'triggered'));
    (g.lastKnown ??= {})[id] = {
      zcc: o.zcc,
      power: c.power,
      toughness: c.toughness,
      ...(o.attachedToPlayer ? { enchantedPlayer: o.attachedToPlayer } : {}),
      ...(o.copyOf ? { copyOf: o.copyOf } : {}),
      ...(granted.length ? { granted } : {}),
      ...(o.faceDown ? { faceDown: o.faceDown } : {}),
    };
  }
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
  if (to === 'battlefield') o.arrived = o.timestamp;
  delete o.loyaltyActivatedTurn;
  delete o.attachedTo;
  delete o.attachedToPlayer;
  delete o.copyOf;
  // CR 708.9: a face-down permanent or spell that leaves is revealed; a face-down spell resolves face down.
  const faceDown = opts.faceDown ?? (from === 'stack' && to === 'battlefield' ? o.faceDown : undefined);
  if (faceDown) o.faceDown = faceDown;
  else if (o.faceDown) {
    delete o.faceDown;
    events.push({ type: 'revealed', player: o.owner, objects: [o.id] });
  }
  delete o.regenShields;
  delete o.foretold;
  delete o.renowned;
  delete o.saddledTurn;
  delete o.activatedOnce;
  delete o.plotted;
  delete o.suspended;
  delete o.activatedTurn;
  delete o.triggeredTurn;
  delete o.monstrous;
  delete o.chosen;
  delete o.exiledBy;
  delete o.skipUntap;
  delete o.classLevel;
  delete o.exileWhenLeaves;
  delete o.exileIfDiesTurn;
  delete o.baseController;
  if (opts.x !== undefined) o.x = opts.x;
  else delete o.x;
  if (castInfo) o.cast = castInfo;
  else delete o.cast;
  o.controller = to === 'battlefield' || to === 'stack' ? (opts.controller ?? o.controller) : o.owner;
  o.face = opts.face ?? (to === 'battlefield' || to === 'stack' ? o.face : 0);

  // CR 400.7j: other parts of the effect that moved it to a public zone can still find it.
  if (g.resolving && to !== 'library' && to !== 'hand') (g.resolving.found ??= {})[id] = o.zcc;
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
    // "onto the battlefield tapped": it enters tapped (it doesn't become tapped, CR 110.5b).
    if (opts.tapped) o.tapped = true;
    // CR 122.6: "returns … with a -1/-1 counter on it" — it enters with them.
    for (const [counter, n] of Object.entries(opts.counters ?? {})) o.counters[counter] = (o.counters[counter] ?? 0) + n;
    // CR 702.145b: if it's night, a daybound double-faced permanent enters transformed.
    const def = g.cards[o.card];
    if (g.dayNight === 'night' && !o.faceDown && def?.faces.length === 2 && def.faces[0]!.keywords.some((k) => k.id === 'daybound') && o.face === 0) o.face = 1;
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
  // CR 714.3a: a Saga enters with a lore counter on it.
  if (to === 'battlefield') addLore(g, o, events);
}

/** The zone-change count an object had (or has) on the battlefield: now if it's there, else as it left. */
export function battlefieldZcc(g: GameState, o: GameObject): number {
  if (o.zone === 'battlefield') return o.zcc;
  const last = g.lastKnown?.[o.id];
  return last && last.zcc === o.zcc - 1 ? last.zcc : o.zcc;
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

/**
 * CR 701.9a: discard a card — from its owner's hand to their graveyard, or to exile for madness
 * (CR 702.35a: "If a player would discard this card, that player discards it, but exiles it instead").
 */
export function discardCard(g: GameState, id: ObjectId, events: GameEvent[]): void {
  const o = obj(g, id);
  const face = faceOf(g, o);
  const madness = face.keywords.some((k) => k.id === 'madness' && k.cost && /^(\{[^}]+\})+$/.test(k.cost));
  moveObject(g, id, madness ? 'exile' : 'graveyard', events);
  events.push({ type: 'discarded', object: id, player: o.owner, ...(madness && o.zone === 'exile' ? { madness: true as const } : {}) });
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
  // "Whenever you draw your second card each turn": count them as they're drawn.
  const drawn = (g.turnLog.drawn ??= {});
  drawn[player] = (drawn[player] ?? 0) + 1;
  events.push({ type: 'drew', player, object: top, nth: drawn[player] });
}

/** Whether the object's printed abilities (or its keywords') include a static ability with this tag. */
/** CR 614.1a: another permanent's "… would die / be put into a graveyard, exile it instead". */
function exiledInstead(g: GameState, o: GameObject, from: ZoneName): boolean {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || a.effect.type !== 'exile_instead') continue;
      const e = a.effect as ExileInsteadNode;
      if (e.dies && from !== 'battlefield') continue;
      if (e.owner === 'you' ? o.owner !== source.controller : e.owner === 'opponents' ? o.owner === source.controller : false) continue;
      if (e.filter && !matchesFilter(g, o, e.filter, { controller: source.controller, source, anyZone: true })) continue;
      return true;
    }
  }
  return false;
}

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
