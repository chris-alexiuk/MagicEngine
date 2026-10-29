import type { CardDef, FaceDef, QuantityReplacementNode, TargetSpec } from '@mtg/schema';
import { chars, hasKeyword, hasType, matchesFilter, objectAbilities, protectedFromAttachment } from './characteristics.js';
import { replaceQuantity } from './quantities.js';
import { onEnterBattlefield } from './registry.js';
import type { GameEvent, GameObject, GameState, ObjectId, PlayerId } from './types.js';
import { abilitySources, createObject, faceOf, livePlayers, moveObject, nameOf, setTapped } from './zones.js';

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

/** CR 122.1c: a shield counter is removed instead of the permanent being dealt damage or destroyed. */
export function removeShield(o: GameObject, events: GameEvent[]): boolean {
  if ((o.counters.shield ?? 0) <= 0) return false;
  o.counters.shield!--;
  if (!o.counters.shield) delete o.counters.shield;
  events.push({ type: 'counters', object: o.id, counter: 'shield', delta: -1 });
  return true;
}

export function destroy(g: GameState, o: GameObject, events: GameEvent[], opts: { noRegen?: boolean } = {}): boolean {
  if (o.zone !== 'battlefield') return false;
  if (hasKeyword(g, o, 'indestructible')) return false;
  // CR 122.1c: "If a permanent with a shield counter on it would be … destroyed, instead remove a shield counter from it."
  if (removeShield(o, events)) return false;
  // CR 701.19c: "can't be regenerated" — the shield doesn't apply.
  if (!opts.noRegen && (o.regenShields ?? 0) > 0 && !chars(g, o).rules.has('cant_be_regenerated')) {
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
  if (target.id === attachment.id) return false;
  // Animate Dead: "enchant creature put onto the battlefield with this Aura" — that creature only.
  const link = g.reanimated?.find((l) => l.aura.id === attachment.id && l.aura.zcc === attachment.zcc);
  if (link) return target.zone === 'battlefield' && target.id === link.creature.id && target.zcc === link.creature.zcc && !protectedFromAttachment(g, target, attachment);
  const face = faceOf(g, attachment);
  // "Enchant creature card in a graveyard" (CR 303.4: an Aura can enchant what its enchant ability allows).
  if (target.zone !== 'battlefield') {
    const enchant = face.subtypes.includes('Aura') ? chars(g, attachment).keywords.find((k) => k.id === 'enchant') : undefined;
    return Boolean(enchant?.filter?.zone && enchant.filter.zone === target.zone && matchesFilter(g, target, enchant.filter, { controller: attachment.controller, source: attachment }));
  }
  if (face.subtypes.includes('Equipment')) {
    // CR 301.5c: an Equipment that's also a creature can't equip a creature unless it has reconfigure (CR 702.151b).
    // CR 702.16d: nor a creature with protection from it.
    return hasType(g, target, 'Creature') && (!hasType(g, attachment, 'Creature') || face.keywords.some((k) => k.id === 'reconfigure')) && !protectedFromAttachment(g, target, attachment);
  }
  if (face.subtypes.includes('Aura')) {
    const enchant = chars(g, attachment).keywords.find((k) => k.id === 'enchant');
    if (!enchant?.filter) return false;
    // CR 702.16c: a permanent with protection from it can't be enchanted by it.
    return matchesFilter(g, target, enchant.filter, { controller: attachment.controller, source: attachment }) && !protectedFromAttachment(g, target, attachment);
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
  // Moved from another permanent: it became unattached from that one.
  if (attachment.attachedTo) events.push({ type: 'unattached', object: attachment.id, from: attachment.attachedTo.id, fromZcc: attachment.attachedTo.zcc });
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

/**
 * Divine Visitation: the token created instead of a creature token under `controller`'s control (CR 614.1a), if any.
 * (The replacement token isn't replaced again, CR 614.5.)
 */
function tokenSwap(g: GameState, controller: PlayerId, face: FaceDef | undefined): FaceDef | undefined {
  if (!face) return undefined;
  for (const id of abilitySources(g)) {
    const src = g.objects[id]!;
    if (src.controller !== controller) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'replace_quantity') continue;
      const e = a.effect as QuantityReplacementNode;
      if (e.event !== 'tokens' || e.op !== 'swap' || !e.extra) continue;
      if (e.tokenFilter?.types && !e.tokenFilter.types.some((t) => face.types.includes(t))) continue;
      return e.extra.token;
    }
  }
  return undefined;
}

/** CR 111.2: a token is created on the battlefield under the control of the player who created it. */
export function createToken(g: GameState, face: FaceDef, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean; swapped?: boolean } = {}): GameObject {
  const swap = opts.swapped ? undefined : tokenSwap(g, controller, face);
  if (swap) return createToken(g, swap, controller, events, { ...opts, swapped: true });
  const o = createObject(g, tokenCard(g, face), controller, 'battlefield');
  o.token = true;
  o.sick = true;
  if (opts.tapped) o.tapped = true;
  intrinsicCounters(g, o);
  onEnterBattlefield(g, o, events);
  events.push({ type: 'created', object: o.id, controller });
  return o;
}

/**
 * CR 306.5b / 310.4b: a planeswalker token enters with its printed loyalty, a battle token with its defense (a token copy of
 * Jace has Jace's loyalty, CR 707.2) — counters it enters with, so replaced like others (CR 614.1a).
 */
function intrinsicCounters(g: GameState, o: GameObject): void {
  const face = faceOf(g, o);
  const put = (counter: 'loyalty' | 'defense', printed: string | undefined) => {
    if (printed === undefined || !/^\d+$/.test(printed) || o.counters[counter]) return;
    const n = replaceQuantity(g, 'counters', Number(printed), { player: o.controller, object: o, counter });
    if (n > 0) o.counters[counter] = n;
  };
  put('loyalty', face.loyalty);
  put('defense', face.defense);
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
export function createTokenCopy(g: GameState, of: { card: string; face: number }, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean; counters?: Record<string, number>; replace?: boolean } = {}): GameObject {
  // Divine Visitation: a token copy of a creature is a creature token too — an Angel is created instead.
  const swap = tokenSwap(g, controller, g.cards[of.card]?.faces[of.face]);
  if (swap) return createToken(g, swap, controller, events, { tapped: opts.tapped, swapped: true });
  const o = createObject(g, of.card, controller, 'battlefield');
  o.face = of.face;
  o.token = true;
  o.sick = true;
  if (opts.tapped) o.tapped = true;
  // Littjara Mirrorlake: "… except it enters with an additional +1/+1 counter on it" (CR 614.1c). Incubate: counters it
  // enters with are put on it (CR 122.6), so Doubling Season doubles them (`replace`).
  for (const [counter, n0] of Object.entries(opts.counters ?? {})) {
    const n = opts.replace ? replaceQuantity(g, 'counters', n0, { player: controller, object: o, counter }) : n0;
    if (n > 0) o.counters[counter] = (o.counters[counter] ?? 0) + n;
  }
  intrinsicCounters(g, o);
  onEnterBattlefield(g, o, events);
  events.push({ type: 'created', object: o.id, controller });
  return o;
}

export function describe(g: GameState, o: GameObject): string {
  return nameOf(g, o);
}
