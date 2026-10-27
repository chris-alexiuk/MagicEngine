import type { CardDef, TriggeredAbility } from '@mtg/schema';
import type { GameEvent, GameState, PlayerId } from './types.js';

/**
 * CR 309: dungeons. A dungeon card starts outside the game; venturing into the dungeon (CR 701.49) puts one into the
 * command zone with the venture marker on its topmost room, or moves the marker down an arrow. Each room has a room
 * ability, "When you move your venture marker into this room, [effect]" (CR 309.4c). Compiled dungeons carry their
 * rooms as triggered abilities of type "room" (with the rooms each one leads to), topmost first.
 */
export interface Room {
  name: string;
  leadsTo: string[];
  ability: TriggeredAbility;
}

export function isDungeon(def: CardDef | undefined): boolean {
  return Boolean(def?.faces[0]?.types.includes('Dungeon'));
}

/** CR 701.49d: Undercity can be entered only by "venture into Undercity" (the initiative, CR 726.2). */
export function isUndercity(def: CardDef): boolean {
  return def.faces[0]!.subtypes.includes('Undercity');
}

export function roomsOf(def: CardDef): Room[] {
  return def.faces[0]!.abilities.flatMap((a) =>
    a.kind === 'triggered' && a.trigger.type === 'room'
      ? [{ name: String(a.trigger.room), leadsTo: (a.trigger.leadsTo as string[] | undefined) ?? [], ability: a }]
      : [],
  );
}

/** The dungeons a player could bring into the game (CR 309.2a): those this game knows, Undercity only when asked for. */
export function dungeonChoices(g: GameState, undercity: boolean): string[] {
  return Object.keys(g.cards).filter((k) => isDungeon(g.cards[k]) && isUndercity(g.cards[k]!) === undercity && roomsOf(g.cards[k]!).length);
}

/** The pseudo-object id of a player's dungeon, the source of its room abilities (CR 309.4c). */
export const dungeonSource = (player: PlayerId) => `dungeon:${player}`;

/** CR 309.4a: the dungeon goes to the command zone with the venture marker on its topmost room. */
export function enterDungeon(g: GameState, player: PlayerId, card: string, events: GameEvent[]): void {
  const first = roomsOf(g.cards[card]!)[0]!;
  g.players[player]!.dungeon = { card, room: first.name };
  events.push({ type: 'room_entered', player, card, room: first.name });
}

export function moveToRoom(g: GameState, player: PlayerId, room: string, events: GameEvent[]): void {
  const d = g.players[player]!.dungeon!;
  d.room = room;
  events.push({ type: 'room_entered', player, card: d.card, room });
}

/** The room the player's venture marker is in, if they have a dungeon. */
export function currentRoom(g: GameState, player: PlayerId): Room | null {
  const d = g.players[player]?.dungeon;
  if (!d) return null;
  return roomsOf(g.cards[d.card]!).find((r) => r.name === d.room) ?? null;
}

/** CR 309.7: removing the dungeon from the game completes it. */
export function completeDungeon(g: GameState, player: PlayerId, events: GameEvent[]): void {
  const ps = g.players[player]!;
  const d = ps.dungeon;
  if (!d) return;
  delete ps.dungeon;
  (ps.completed ??= []).push(g.cards[d.card]!.name);
  events.push({ type: 'dungeon_completed', player, card: d.card });
}

/**
 * CR 704.5t: a venture marker on the bottommost room, once that room's ability has left the stack, completes the
 * dungeon. Returns whether it did.
 */
export function checkDungeonDone(g: GameState, player: PlayerId, events: GameEvent[]): boolean {
  const room = currentRoom(g, player);
  if (!room || room.leadsTo.length) return false;
  const src = dungeonSource(player);
  const waiting = g.triggers.some((t) => t.source.id === src) || g.stack.some((s) => s.kind === 'ability' && s.source.id === src);
  if (waiting) return false;
  completeDungeon(g, player, events);
  return true;
}

/** CR 726.2: the initiative's three inherent triggered abilities. They have no source. */
export const VENTURE_UNDERCITY: TriggeredAbility = {
  kind: 'triggered',
  text: 'The initiative — venture into Undercity.',
  trigger: { type: 'phase', step: 'upkeep', whose: 'you' },
  effects: [{ type: 'venture', undercity: true }],
};
export const TAKE_INITIATIVE: TriggeredAbility = {
  kind: 'triggered',
  text: 'Whenever one or more creatures a player controls deal combat damage to the player who has the initiative, the controller of those creatures takes the initiative.',
  trigger: { type: 'deals_combat_damage', subject: { ref: 'all', filter: { types: ['Creature'] } }, to: 'player' },
  effects: [{ type: 'take_initiative', who: { ref: 'you' } }],
};

/** Room abilities that just triggered, and the initiative's abilities (CR 309.4c, 726.2). */
export function collectDungeonTriggers(g: GameState, batch: GameEvent[]): void {
  const push = (controller: PlayerId, source: string, sourceName: string, ability: TriggeredAbility) =>
    g.triggers.push({ id: `t${g.nextId++}`, controller, source: { id: source, zcc: 0 }, sourceName, ability, info: {} });
  const stole = new Set<PlayerId>();
  for (const e of batch) {
    if (e.type === 'room_entered') {
      const def = g.cards[e.card];
      const room = def ? roomsOf(def).find((r) => r.name === e.room) : undefined;
      if (room) push(e.player, dungeonSource(e.player), `${def!.name}: ${room.name}`, room.ability);
    }
    if (!g.initiative) continue;
    // "At the beginning of the upkeep of the player who has the initiative, that player ventures into Undercity."
    if (e.type === 'step' && e.step === 'upkeep' && g.active === g.initiative) push(g.initiative, 'initiative', 'The initiative', VENTURE_UNDERCITY);
    // "Whenever a player takes the initiative, that player ventures into Undercity."
    if (e.type === 'initiative') push(e.player, 'initiative', 'The initiative', VENTURE_UNDERCITY);
    // "Whenever one or more creatures a player controls deal combat damage to the player who has the initiative, …"
    if (e.type === 'damage' && e.combat && e.to.kind === 'player' && e.to.player === g.initiative) {
      const o = g.objects[e.source];
      if (o && o.controller !== g.initiative && !stole.has(o.controller) && g.cards[o.card]?.faces[o.face]?.types.includes('Creature')) {
        stole.add(o.controller);
        push(o.controller, 'initiative', 'The initiative', TAKE_INITIATIVE);
      }
    }
  }
}
