import type { CardDef, FaceDef, TargetSpec } from '@mtg/schema';
import { chars, hasKeyword, hasType, matchesFilter, protectedFromAttachment } from './characteristics.js';
import { replaced, type Destroy, type TokenLot, type Tokens } from './instead.js';
import { DESTROY_RULES, destroyQuestion } from './instead-destroy.js';
import { TOKEN_RULES, noFewerTokens, settling, tokensQuestion } from './instead-tokens.js';
import { counterBlocked, replaceQuantity } from './quantities.js';
import { onEnterBattlefield } from './registry.js';
import type { GameEvent, GameObject, GameState, ObjectId, PlayerId } from './types.js';
import { createObject, faceOf, livePlayers, moveObject, moveTogether, nameOf } from './zones.js';
import { playerProtectedFrom } from './player-rules.js';

/** CR 122.1c: a shield counter is removed instead of the permanent being dealt damage or destroyed. */
export function removeShield(o: GameObject, events: GameEvent[]): boolean {
  if ((o.counters.shield ?? 0) <= 0) return false;
  o.counters.shield!--;
  if (!o.counters.shield) delete o.counters.shield;
  events.push({ type: 'counters', object: o.id, counter: 'shield', delta: -1 });
  return true;
}

/**
 * CR 701.8a: destroying a permanent moves it to its owner's graveyard — unless it can't be destroyed, or something
 * happens instead. Returns whether it was destroyed.
 */
export function destroy(g: GameState, o: GameObject, events: GameEvent[], opts: { noRegen?: boolean } = {}): boolean {
  if (!isDestroyed(g, o, events, opts)) return false;
  moveObject(g, o.id, 'graveyard', events);
  return true;
}

/**
 * Destroys several permanents at once (CR 608.2c: "Destroy all creatures"; CR 704.3: state-based actions): those that
 * are destroyed go to their graveyards together, so what would replace that for one is settled before any has left.
 */
export function destroyTogether(g: GameState, objects: GameObject[], events: GameEvent[], opts: { noRegen?: boolean } = {}, alongside: Iterable<ObjectId> = []): void {
  const dying = objects.filter((o) => isDestroyed(g, o, events, opts));
  // `alongside`: permanents put into their graveyards at the same time without being destroyed (CR 704.5f: toughness 0).
  moveTogether(
    g,
    [...alongside, ...dying.map((o) => o.id)].map((id) => ({ id, to: 'graveyard' as const })),
    events,
  );
}

/**
 * Whether destroying this permanent puts it into its owner's graveyard. What the replacement effects on its destruction
 * make of that (CR 614.1a, 616.1) — a shield counter removed, a regeneration shield used, its Umbra destroyed — is
 * done here; each is a rule in instead-destroy.ts, none is known here.
 */
function isDestroyed(g: GameState, o: GameObject, events: GameEvent[], opts: { noRegen?: boolean }): boolean {
  if (o.zone !== 'battlefield') return false;
  // CR 702.12b: a permanent with indestructible can't be destroyed — so there is nothing to replace either.
  if (hasKeyword(g, o, 'indestructible')) return false;
  const asked: Destroy = { kind: 'destroy', object: o, noRegen: Boolean(opts.noRegen), also: [] };
  const settled = replaced(g, asked, DESTROY_RULES, { by: o.controller, about: () => destroyQuestion(g, asked) }) ?? asked;
  for (const more of settled.also) more.run(g, o, events);
  return settled.saved === undefined;
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
 * CR 701.21a: several permanents sacrificed at once ("sacrifice all creatures"; CR 101.4: "each player sacrifices a
 * creature") — each by its controller. They leave together: what would replace that for one is settled before any
 * has left.
 */
export function sacrificeTogether(g: GameState, those: { object: GameObject; player: PlayerId; exploitedBy?: ObjectId }[], events: GameEvent[]): void {
  moveTogether(
    g,
    those
      .filter((s) => s.object.zone === 'battlefield' && s.object.controller === s.player)
      .map((s) => ({
        id: s.object.id,
        to: 'graveyard' as const,
        before: () => void events.push({ type: 'sacrificed', object: s.object.id, player: s.player, ...(s.exploitedBy ? { exploitedBy: s.exploitedBy } : {}) }),
      })),
    events,
  );
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
  // CR 702.16c: not by an Aura with a quality they have protection from.
  if (playerProtectedFrom(g, player, aura)) return false;
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

/** How the tokens asked for are created. */
export interface TokenOptions {
  tapped?: boolean;
  /** A copy: counters it enters with besides (Littjara Mirrorlake: "except it enters with an additional +1/+1 counter"). */
  counters?: Record<string, number>;
  /** Those are counters an effect puts on it (incubate), so effects on that apply (CR 122.6). */
  replace?: boolean;
  /**
   * The event this creation is part of, where an effect creates tokens in several goes ("create X Halflings and X
   * Foods", a token for each opponent): the effects that have added their one token to it. Each go passes the same list.
   */
  event?: string[];
  /** Done with each of the tokens asked for as it is created — not with those an effect added to them. */
  each?: (token: GameObject) => void;
}

/**
 * CR 111.1: `player` creates `n` tokens with this face. What the replacement effects on that make of it (CR 614.1a,
 * 616.1) — twice as many, Angels instead, a Food besides — is settled first; each is a rule in instead-tokens.ts, none
 * is known here. Returns "those tokens": the ones asked for as the effects left them, not the ones an effect added.
 */
export function createTokens(g: GameState, player: PlayerId, face: FaceDef, n: number, events: GameEvent[], opts: TokenOptions = {}): GameObject[] {
  return created(g, player, { face, n }, events, opts);
}

/** CR 707.2 / 111.1: `player` creates `n` tokens that are copies of something — of its copiable values. See `createTokens`. */
export function createTokenCopies(g: GameState, player: PlayerId, of: { card: string; face: number }, n: number, events: GameEvent[], opts: TokenOptions = {}): GameObject[] {
  const face = g.cards[of.card]?.faces[of.face];
  // (A copy of nothing the game knows: put there as it is.)
  if (!face) return Array.from({ length: Math.max(0, n) }, () => putTokenCopy(g, of, player, events, opts));
  return created(g, player, { face, copy: of, n }, events, opts);
}

function created(g: GameState, player: PlayerId, lot: TokenLot, events: GameEvent[], opts: TokenOptions): GameObject[] {
  if (lot.n <= 0) return [];
  const asked: Tokens = { kind: 'tokens', player, lots: [lot], already: opts.event ?? [] };
  const applied = new Set<string>();
  const settled = settling(g, () => replaced(g, asked, TOKEN_RULES, { by: player, about: () => tokensQuestion(g, asked), noWorse: noFewerTokens }, applied)) ?? asked;
  opts.event?.push(...applied);
  const those: GameObject[] = [];
  // The tokens asked for, then the ones added to them.
  for (const added of [false, true]) {
    for (const made of settled.lots) {
      if (Boolean(made.added) !== added) continue;
      for (let i = 0; i < made.n; i++) {
        // What the effect says of its tokens — tapped, with a counter — it says of the ones it asked for.
        const how = added ? {} : opts;
        const token = made.copy ? putTokenCopy(g, made.copy, player, events, how) : putToken(g, made.face, player, events, how);
        if (added) continue;
        opts.each?.(token);
        those.push(token);
      }
    }
  }
  return those;
}

/** CR 111.2: a token is created on the battlefield under the control of the player who created it. */
function putToken(g: GameState, face: FaceDef, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean }): GameObject {
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
function putTokenCopy(g: GameState, of: { card: string; face: number }, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean; counters?: Record<string, number>; replace?: boolean }): GameObject {
  const o = createObject(g, of.card, controller, 'battlefield');
  o.face = of.face;
  o.token = true;
  o.sick = true;
  if (opts.tapped) o.tapped = true;
  // Littjara Mirrorlake: "… except it enters with an additional +1/+1 counter on it" (CR 614.1c). Incubate: counters it
  // enters with are put on it (CR 122.6), so Doubling Season doubles them (`replace`).
  for (const [counter, n0] of Object.entries(opts.counters ?? {})) {
    const n = opts.replace ? replaceQuantity(g, 'counters', n0, { player: controller, object: o, counter }) : counterBlocked(g, o, counter) ? 0 : n0;
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
