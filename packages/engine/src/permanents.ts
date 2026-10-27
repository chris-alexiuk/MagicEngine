import type { CardDef, FaceDef, TargetSpec } from '@mtg/schema';
import { chars, hasKeyword, hasType, matchesFilter } from './characteristics.js';
import { onEnterBattlefield } from './registry.js';
import type { GameEvent, GameObject, GameState, ObjectId, PlayerId } from './types.js';
import { createObject, faceOf, livePlayers, moveObject, nameOf, setTapped } from './zones.js';

/**
 * CR 701.8a: destroying moves a permanent to its owner's graveyard.
 * CR 702.12b: indestructible permanents aren't destroyed.
 * CR 701.19a: a regeneration shield replaces the destruction.
 * Returns whether it was destroyed.
 */
/**
 * CR 702.89a (umbra armor): "If enchanted permanent would be destroyed, instead remove all damage marked on it and
 * destroy this Aura." The first such Aura is destroyed instead (the controller's choice; the engine takes the oldest).
 */
function umbraArmor(g: GameState, o: GameObject): GameObject | undefined {
  return g.zones.battlefield
    .map((id) => g.objects[id]!)
    .find((a) => a.attachedTo?.id === o.id && a.attachedTo.zcc === o.zcc && faceOf(g, a).keywords.some((k) => k.id === 'umbra_armor' || k.id === 'totem_armor'));
}

export function destroy(g: GameState, o: GameObject, events: GameEvent[], opts: { noRegen?: boolean } = {}): boolean {
  if (o.zone !== 'battlefield') return false;
  if (hasKeyword(g, o, 'indestructible')) return false;
  if (!opts.noRegen && (o.regenShields ?? 0) > 0) {
    // CR 701.19a: instead remove all damage from it, tap it, and remove it from combat.
    o.regenShields!--;
    o.damage = 0;
    delete o.deathtouched;
    setTapped(g, o.id, true, events);
    removeFromCombat(g, o.id);
    events.push({ type: 'regenerated', object: o.id });
    return false;
  }
  const umbra = umbraArmor(g, o);
  if (umbra) {
    o.damage = 0;
    delete o.deathtouched;
    destroy(g, umbra, events);
    return false;
  }
  moveObject(g, o.id, 'graveyard', events);
  return true;
}

/** CR 506.4: a permanent removed from combat stops being an attacking or blocking creature. */
export function removeFromCombat(g: GameState, id: ObjectId): void {
  if (!g.combat) return;
  delete g.combat.attackers[id];
  delete g.combat.blockers[id];
  for (const a of Object.values(g.combat.attackers)) a.blockers = a.blockers.filter((b) => b.id !== id);
}

/**
 * CR 701.21a: its controller moves it from the battlefield to its owner's graveyard. Not destruction.
 * `exploitedBy`: CR 702.110b — sacrificed as that creature's exploit ability resolved.
 */
export function sacrifice(g: GameState, o: GameObject, player: PlayerId, events: GameEvent[], exploitedBy?: ObjectId): boolean {
  if (o.zone !== 'battlefield' || o.controller !== player) return false;
  events.push({ type: 'sacrificed', object: o.id, player, ...(exploitedBy ? { exploitedBy } : {}) });
  moveObject(g, o.id, 'graveyard', events);
  return true;
}

/**
 * Whether an Aura or Equipment could be attached to `target`.
 * CR 301.5: Equipment only to creatures (CR 301.5c: not while it's a creature itself).
 * CR 303.4: an Aura per its enchant ability (CR 303.4d: never to itself).
 */
export function canAttach(g: GameState, attachment: GameObject, target: GameObject): boolean {
  if (target.zone !== 'battlefield' || target.id === attachment.id) return false;
  const face = faceOf(g, attachment);
  if (face.subtypes.includes('Equipment')) {
    return hasType(g, target, 'Creature') && !hasType(g, attachment, 'Creature');
  }
  if (face.subtypes.includes('Aura')) {
    const enchant = chars(g, attachment).keywords.find((k) => k.id === 'enchant');
    if (!enchant?.filter) return false;
    return matchesFilter(g, target, enchant.filter, { controller: attachment.controller, source: attachment });
  }
  return false;
}

/**
 * What an Aura spell targets (CR 303.4a): an object its enchant ability allows, or a player
 * for "enchant player" / "enchant opponent".
 */
export function auraTargetSpec(face: FaceDef): TargetSpec | null {
  if (!face.subtypes.includes('Aura')) return null;
  const enchant = face.keywords.find((k) => k.id === 'enchant' && (k.filter || k.player));
  if (!enchant) return null;
  if (enchant.player) return { what: 'player', ...(enchant.player === 'opponent' ? { player: 'opponent' as const } : {}), text: `${enchant.text} to enchant` };
  return { what: 'object', filter: enchant.filter!, text: `${enchant.text} to enchant` };
}

/** CR 303.4d / 704.5m: whether an Aura can stay attached to this player. */
export function canEnchantPlayer(g: GameState, aura: GameObject, player: PlayerId): boolean {
  if (!livePlayers(g).includes(player)) return false;
  const enchant = chars(g, aura).keywords.find((k) => k.id === 'enchant');
  if (!enchant?.player) return false;
  return enchant.player === 'any' || player !== aura.controller;
}

/** CR 701.3a: attach it; CR 701.3b: if it can't be attached there, it doesn't move. CR 613.7e: new timestamp. */
export function attach(g: GameState, attachment: GameObject, target: GameObject, events: GameEvent[]): boolean {
  if (attachment.zone !== 'battlefield' || !canAttach(g, attachment, target)) return false;
  if (attachment.attachedTo?.id === target.id && attachment.attachedTo.zcc === target.zcc) return false;
  attachment.attachedTo = { id: target.id, zcc: target.zcc };
  attachment.timestamp = ++g.clock;
  events.push({ type: 'attached', object: attachment.id, to: target.id });
  return true;
}

/** Registers a token's definition in the game so it is self-contained and replayable. */
function tokenCard(g: GameState, face: FaceDef): string {
  const json = JSON.stringify(face);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 31) + json.charCodeAt(i)) | 0;
  const key = `token:${face.name}:${(h >>> 0).toString(36)}`;
  if (!g.cards[key]) {
    const def: CardDef = {
      id: key,
      name: face.name,
      layout: 'token',
      cmc: 0,
      colorIdentity: [...face.colors],
      faces: [face],
      legal: {},
      set: '',
      rarity: 'token',
      automation: face.unparsed.length ? 'partial' : 'full',
    };
    g.cards[key] = def;
  }
  return key;
}

/** CR 111.2: a token is created on the battlefield under the control of the player who created it. */
export function createToken(g: GameState, face: FaceDef, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean } = {}): GameObject {
  const o = createObject(g, tokenCard(g, face), controller, 'battlefield');
  o.token = true;
  o.sick = true;
  if (opts.tapped) o.tapped = true;
  onEnterBattlefield(g, o, events);
  events.push({ type: 'created', object: o.id, controller });
  return o;
}

/** CR 114.1–114.2: an emblem with these abilities, put into the command zone; it's owned and controlled by `player`. */
export function createEmblem(g: GameState, face: FaceDef, player: PlayerId): GameObject {
  const json = JSON.stringify(face);
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 31) + json.charCodeAt(i)) | 0;
  const key = `emblem:${(h >>> 0).toString(36)}`;
  if (!g.cards[key]) {
    g.cards[key] = { id: key, name: face.name, layout: 'emblem', cmc: 0, colorIdentity: [], faces: [face], legal: {}, set: '', rarity: 'emblem', automation: 'full' };
  }
  const o = createObject(g, key, player, 'command');
  o.emblem = true;
  return o;
}

/** CR 707.2 / CR 111.1: a token that's a copy of something — it has those copiable values. */
export function createTokenCopy(g: GameState, of: { card: string; face: number }, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean } = {}): GameObject {
  const o = createObject(g, of.card, controller, 'battlefield');
  o.face = of.face;
  o.token = true;
  o.sick = true;
  if (opts.tapped) o.tapped = true;
  onEnterBattlefield(g, o, events);
  events.push({ type: 'created', object: o.id, controller });
  return o;
}

export function describe(g: GameState, o: GameObject): string {
  return nameOf(g, o);
}
