import { isRoom, roomFace } from './rooms.js';
import { faceDownFace } from './face-down.js';
import type { CardDef, CastOptionNode, ExileInsteadNode, FaceDef } from '@mtg/schema';
import { RulesError, type GameEvent, type GameObject, type GameState, type ObjectId, type PlayerId, type ZoneName } from './types.js';
import { onEnterBattlefield } from './registry.js';
import { chars, isModified, matchesFilter, objectAbilities } from './characteristics.js';
import { addLore } from './sagas.js';
import { shuffleInPlace } from './rng.js';
import { replaceQuantity } from './quantities.js';
import { playerRule } from './player-rules.js';

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
  // CR 709.5: a Room on the battlefield has only its unlocked doors' name, mana cost and rules text.
  if (o.unlocked && o.zone === 'battlefield' && !o.copyOf) return roomFace(def, o.unlocked);
  // CR 702.102b / 709.4d: a fused split spell has the combined characteristics of its two halves.
  if (o.fused && o.zone === 'stack' && !o.copyOf) return fusedFace(def);
  const face = def.faces[at.face] ?? def.faces[0]!;
  // CR 718.3b / 718.3d: a prototyped spell or permanent (or a copy of one) has the prototype characteristics.
  if (o.prototyped && !o.copyOf && (o.zone === 'battlefield' || o.zone === 'stack')) return prototypedFace(face);
  return o.bestowed && (o.zone === 'battlefield' || o.zone === 'stack') ? bestowedFace(face) : face;
}

const FUSED = new WeakMap<CardDef, FaceDef>();
/**
 * CR 702.102b / 709.4d: both halves of a split card at once — both names, the two mana costs together, every color
 * and type, and the left half's text followed by the right half's (CR 702.102d).
 */
export function fusedFace(def: CardDef): FaceDef {
  let out = FUSED.get(def);
  if (!out) {
    const [l, r] = [def.faces[0]!, def.faces[1] ?? def.faces[0]!];
    const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];
    out = {
      ...l,
      name: `${l.name} // ${r.name}`,
      manaCost: `${l.manaCost}${r.manaCost}`,
      typeLine: l.typeLine === r.typeLine ? l.typeLine : `${l.typeLine} // ${r.typeLine}`,
      supertypes: union(l.supertypes, r.supertypes),
      types: union(l.types, r.types),
      subtypes: union(l.subtypes, r.subtypes),
      oracle: `${l.oracle}\n${r.oracle}`,
      colors: union(l.colors, r.colors),
      keywords: union(l.keywords, r.keywords),
      abilities: [...l.abilities, ...r.abilities],
      unparsed: [...l.unparsed, ...r.unparsed],
      ...(l.manualKeywords || r.manualKeywords ? { manualKeywords: [...(l.manualKeywords ?? []), ...(r.manualKeywords ?? [])] } : {}),
    };
    FUSED.set(def, out);
  }
  return out;
}

const PROTOTYPED = new WeakMap<FaceDef, FaceDef>();
/** CR 718.3b: the inset mana cost, power and toughness; colored symbols in that cost are its colors (CR 105.2). */
export function prototypedFace(face: FaceDef): FaceDef {
  let out = PROTOTYPED.get(face);
  if (!out) {
    const opt = face.abilities.flatMap((a) => (a.kind === 'static' && a.effect.type === 'cast_option' && a.effect.prototype ? [a.effect as CastOptionNode] : []))[0];
    if (!opt) return face;
    const manaCost = String(opt.cost.mana ?? '');
    const symbols = manaCost.match(/\{[^}]+\}/g) ?? [];
    const colors = (['W', 'U', 'B', 'R', 'G'] as const).filter((c) => symbols.some((s) => s.includes(c)));
    out = { ...face, manaCost, power: opt.prototype!.power, toughness: opt.prototype!.toughness, colors: colors.length ? [...colors] : face.colors };
    PROTOTYPED.set(face, out);
  }
  return out;
}

const BESTOWED = new WeakMap<FaceDef, FaceDef>();
/**
 * CR 702.103b: a bestowed spell or permanent is an Aura enchantment with enchant creature; it loses the
 * creature type and creature subtypes (so it has no power or toughness).
 */
export function bestowedFace(face: FaceDef): FaceDef {
  let out = BESTOWED.get(face);
  if (!out) {
    const { power: _p, toughness: _t, ...rest } = face;
    out = {
      ...rest,
      types: face.types.filter((t) => t !== 'Creature'),
      subtypes: ['Aura'],
      keywords: [...face.keywords, { id: 'enchant', text: 'creature', filter: { types: ['Creature'] } }],
    };
    BESTOWED.set(face, out);
  }
  return out;
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
  // CR 718.3b: a prototyped spell or permanent; CR 709.5c: a Room's unlocked doors.
  if ((o.prototyped || o.unlocked) && !o.copyOf && (o.zone === 'battlefield' || o.zone === 'stack')) return costManaValue(faceOf(g, o).manaCost);
  const def = g.cards[(o.copyOf ?? o).card];
  // CR 709.4d: a fused split spell — both halves' mana costs.
  if (o.fused && o.zone === 'stack' && def && !o.copyOf) return costManaValue(fusedFace(def).manaCost);
  // CR 709.3b / 715.3b / 712.8f: a split half, an adventure or a modal double-faced card's face being cast (or, for a
  // modal double-faced card, on the battlefield) has only that face's mana cost.
  if (def && !o.copyOf && def.faces.length > 1 && ((o.zone === 'stack' && ['split', 'adventure', 'modal_dfc'].includes(def.layout)) || (o.zone === 'battlefield' && def.layout === 'modal_dfc'))) {
    return costManaValue(faceOf(g, o).manaCost);
  }
  return def?.cmc ?? 0;
}

/** CR 202.3: the total of a mana cost's symbols ({X} is 0; {2/W} counts 2). */
export function costManaValue(cost: string): number {
  let n = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1]!;
    if (/^\d+$/.test(s)) n += Number(s);
    else if (/^2\//.test(s)) n += 2;
    else if (s !== 'X' && s !== 'Y' && s !== 'Z') n += 1;
  }
  return n;
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
  opts: { position?: 'top' | 'bottom' | number; controller?: PlayerId; face?: number; x?: number; counters?: Record<string, number>; faceDown?: GameObject['faceDown']; tapped?: boolean } = {},
): void {
  const o = obj(g, id);
  const from = o.zone;
  // CR 614.1a: "exile it instead" replaces the move — flashback (CR 702.34a), "if it would die this turn",
  // and "if ~ would be put into a graveyard from anywhere".
  if (from === 'stack' && o.exileOnLeave) to = 'exile';
  if (from === 'battlefield' && o.exileWhenLeaves) to = 'exile';
  if (to === 'graveyard' && from === 'battlefield' && o.exileIfDiesTurn === g.turn) to = 'exile';
  if (to === 'graveyard' && hasStaticTag(g, o, 'graveyard_to_exile')) to = 'exile';
  const instead = to === 'graveyard' ? exiledInstead(g, o, from) : null;
  if (instead) to = 'exile';
  // "If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead."
  const shuffleInstead = to === 'graveyard' && hasStaticTag(g, o, 'graveyard_to_library');
  if (shuffleInstead) to = 'library';
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
      // CR 603.10a: "Whenever a creature with a +1/+1 counter on it dies", "a modified creature" — as it last existed.
      ...(Object.keys(o.counters).length ? { counters: { ...o.counters } } : {}),
      ...(isModified(g, o) ? { modified: true } : {}),
      types: [...c.types],
      subtypes: [...c.subtypes],
      ...(o.attachedToPlayer ? { enchantedPlayer: o.attachedToPlayer } : {}),
      ...(o.attachedTo ? { attachedTo: { ...o.attachedTo } } : {}),
      ...(o.copyOf ? { copyOf: o.copyOf } : {}),
      ...(granted.length ? { granted } : {}),
      ...(o.faceDown ? { faceDown: o.faceDown } : {}),
      // Floating Shield: "Sacrifice this Aura: … protection from the chosen color" — what was chosen as it entered.
      ...(o.chosen ? { chosen: { ...o.chosen } } : {}),
    };
  }
  // "for each creature destroyed this way": the resolving effect that moved it, and what it was.
  if (g.resolving) {
    const r = g.resolving;
    (r.moves ??= []).push({
      id,
      effect: String(r.effects[r.index]?.type ?? ''),
      from,
      to,
      types: from === 'battlefield' ? [...(g.lastKnown?.[id]?.types ?? [])] : [...chars(g, o).types],
      subtypes: from === 'battlefield' ? [...(g.lastKnown?.[id]?.subtypes ?? [])] : [...chars(g, o).subtypes],
      controller: o.controller,
      ...(o.token ? { token: true as const } : {}),
    });
  }
  const castInfo = from === 'stack' && to === 'battlefield' ? o.cast : undefined;
  const faceBefore = o.face;
  removeFromCurrentZone(g, o);

  o.zone = to;
  o.zcc++;
  // CR 400.7a: effects from spells and abilities that changed a spell on the stack (Rivaz of the Claw: "it gains 'When
  // this creature dies, exile it.'") continue to apply to the permanent it becomes.
  if (from === 'stack' && to === 'battlefield') {
    for (const e of g.effects) for (const r of e.objects) if (r.id === id && r.zcc === o.zcc - 1) r.zcc = o.zcc;
  }
  o.tapped = false;
  o.damage = 0;
  o.counters = {};
  // Dauthi Voidwalker: "instead exile it with a void counter on it".
  if (instead?.node.withCounter) o.counters[instead.node.withCounter] = 1;
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
  delete o.hiddenFor;
  delete o.renowned;
  delete o.saddledTurn;
  delete o.goadedBy;
  delete o.prepared;
  delete o.ringBearer;
  if (o.phasedOut) {
    g.phasedOut = (g.phasedOut ?? []).filter((x) => x !== id);
    delete o.phasedOut;
  }
  delete o.copyRevert;
  delete o.untapLocks;
  delete o.mustBlock;
  delete o.cantBlockThis;
  delete o.unlocked;
  // CR 702.103b: bestowed only on the stack and the battlefield it resolves onto.
  if (!(from === 'stack' && to === 'battlefield')) delete o.bestowed;
  // CR 702.102: fused only while it's a spell.
  delete o.fused;
  // CR 718.4: prototyped only on the stack and the battlefield it resolves onto.
  if (!(from === 'stack' && to === 'battlefield')) delete o.prototyped;
  delete o.exerted;
  delete o.exertedTurn;
  delete o.activations;
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
  if (instead && o.zone === 'exile') {
    // The Darkness Crystal: "… instead exile it and you gain 2 life." — exiled with it (CR 607.2a).
    o.exiledBy = { id: instead.source.id, zcc: battlefieldZcc(g, instead.source) };
    if (instead.node.gainLife) {
      const p = instead.source.controller;
      const n = replaceQuantity(g, 'gain_life', instead.node.gainLife, { player: p });
      const ps = g.players[p]!;
      if (n > 0 && !playerRule(g, p, 'cant_gain_life') && !playerRule(g, p, 'life_cant_change')) {
        ps.life += n;
        events.push({ type: 'life', player: p, delta: n, life: ps.life });
      }
    }
  }

  // CR 400.7j: other parts of the effect that moved it to a public zone can still find it.
  if (g.resolving && to !== 'library' && to !== 'hand') (g.resolving.found ??= {})[id] = o.zcc;
  if (to !== 'stack') {
    const list = zoneList(g, to, o.owner);
    // Libraries are top-first; graveyards and other zones append (last = most recent / top).
    if (to === 'library') {
      if (opts.position === 'bottom') list.push(id);
      // Approach of the Second Sun: "seventh from the top" (at the bottom if there are fewer cards, CR 401.4).
      else if (typeof opts.position === 'number') list.splice(Math.min(list.length, opts.position - 1), 0, id);
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
    // CR 709.5d: a Room enters with the door that was cast unlocked (neither, if it wasn't cast).
    if (isRoom(def) && !o.faceDown) {
      const half = castInfo && !castInfo.copy ? faceBefore : -1;
      o.unlocked = [half === 0, half === 1];
      o.face = 0;
      if (half === 0 || half === 1) events.push({ type: 'unlocked', object: id, half, player: o.controller, full: false });
    }
    if (g.dayNight === 'night' && !o.faceDown && def?.faces.length === 2 && def.faces[0]!.keywords.some((k) => k.id === 'daybound') && o.face === 0) o.face = 1;
    const face = faceOf(g, o);
    // CR 702.44a: sunburst — a +1/+1 counter (a charge counter if it isn't a creature) for each color spent to cast it.
    if (face.keywords.some((k) => k.id === 'sunburst') && o.cast?.colors) {
      const kind = face.types.includes('Creature') ? '+1/+1' : 'charge';
      o.counters[kind] = (o.counters[kind] ?? 0) + o.cast.colors;
    }
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
  if (to === 'battlefield') addLore(g, o, events, true);
  if (shuffleInstead) {
    events.push({ type: 'revealed', player: o.owner, objects: [o.id] });
    shuffleInPlace(g, zoneList(g, 'library', o.owner));
    events.push({ type: 'shuffled', player: o.owner });
  }
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

/**
 * Teferi's Ageless Insight, Alhammarret's Archive: "If you would draw a card [except the first one you draw in each of your
 * draw steps], draw two cards instead." — how many such replacements apply to this draw (CR 614.1a, 614.5: each once).
 */
function drawReplacements(g: GameState, player: PlayerId): number {
  const firstInDrawStep = g.step === 'draw' && g.active === player && !(g.turnLog.drawStepDrew ?? []).includes(player);
  let n = 0;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    if (source.controller !== player) continue;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || a.effect.type !== 'draw_replacement' || a.effect.emptyWin || a.effect.steal) continue;
      if (a.effect.exceptFirst && firstInDrawStep) continue;
      n++;
    }
  }
  return n;
}

/**
 * Notion Thief: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead that
 * player skips that draw and you draw a card." — who draws instead, if anyone (CR 614.1a).
 */
function drawThief(g: GameState, player: PlayerId): PlayerId | null {
  if (g.step === 'draw' && g.active === player && !(g.turnLog.drawStepDrew ?? []).includes(player)) return null;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    if (source.controller === player || g.players[source.controller]?.lost) continue;
    if (objectAbilities(g, source).some((a) => a.kind === 'static' && a.effect.type === 'draw_replacement' && a.effect.steal)) return source.controller;
  }
  return null;
}

/** Narset, Parter of Veils: "Each opponent can't draw more than one card each turn." */
function drawLimited(g: GameState, player: PlayerId): boolean {
  if (!(g.turnLog.drawn?.[player] ?? 0)) return false;
  return abilitySources(g).some((id) => {
    const source = g.objects[id]!;
    return objectAbilities(g, source).some((a) => {
      if (a.kind !== 'static' || a.effect.type !== 'player_rule' || a.effect.rule !== 'max_one_draw') return false;
      const who = a.effect.who;
      if (who === 'enchanted') return source.attachedToPlayer === player;
      return who === 'each' || (who === 'you' ? player === source.controller : player !== source.controller);
    });
  });
}

function emptyDrawWins(g: GameState, player: PlayerId): boolean {
  return abilitySources(g).some((id) => {
    const source = g.objects[id]!;
    return source.controller === player && objectAbilities(g, source).some((a) => a.kind === 'static' && a.effect.type === 'draw_replacement' && a.effect.emptyWin);
  });
}

/** Draws one card. CR 704.5b / 104.3c: drawing from an empty library is recorded for state-based actions. */
export function drawCard(g: GameState, player: PlayerId, events: GameEvent[], replaced = false): void {
  // CR 121.2: a draw that can't happen doesn't (Narset) — it isn't a draw from an empty library either.
  if (drawLimited(g, player)) return;
  // Notion Thief: that player skips the draw; its controller draws instead.
  const thief = drawThief(g, player);
  if (thief) {
    drawCard(g, thief, events);
    return;
  }
  if (g.step === 'draw' && g.active === player) {
    const replacements = replaced ? 0 : drawReplacements(g, player);
    const drew = (g.turnLog.drawStepDrew ??= []);
    if (!drew.includes(player)) drew.push(player);
    if (replacements) {
      for (let i = 0; i < 2 ** replacements; i++) drawCard(g, player, events, true);
      return;
    }
  } else if (!replaced) {
    const replacements = drawReplacements(g, player);
    if (replacements) {
      for (let i = 0; i < 2 ** replacements; i++) drawCard(g, player, events, true);
      return;
    }
  }
  const library = zoneList(g, 'library', player);
  const top = library[0];
  if (!top) {
    // Laboratory Maniac: "If you would draw a card while your library has no cards in it, you win the game instead."
    if (emptyDrawWins(g, player)) g.players[player]!.wonByEffect = true;
    else g.players[player]!.drewFromEmptyLibrary = true;
    return;
  }
  moveObject(g, top, 'hand', events);
  // "Whenever you draw your second card each turn": count them as they're drawn.
  const drawn = (g.turnLog.drawn ??= {});
  drawn[player] = (drawn[player] ?? 0) + 1;
  ((g.turnLog.drawnIds ??= {})[player] ??= []).push(top);
  const inDrawStep = g.step === 'draw' && g.active === player;
  const first = inDrawStep && !g.turnLog.drawStepCards;
  if (inDrawStep) g.turnLog.drawStepCards = (g.turnLog.drawStepCards ?? 0) + 1;
  events.push({ type: 'drew', player, object: top, nth: drawn[player], ...(first ? { firstInDrawStep: true as const } : {}) });
}

/** Whether the object's printed abilities (or its keywords') include a static ability with this tag. */
/** CR 614.1a: another permanent's "… would die / be put into a graveyard, exile it instead". */
function exiledInstead(g: GameState, o: GameObject, from: ZoneName): { node: ExileInsteadNode; source: GameObject } | null {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || a.effect.type !== 'exile_instead') continue;
      const e = a.effect as ExileInsteadNode;
      if (e.dies && from !== 'battlefield') continue;
      if (e.owner === 'you' ? o.owner !== source.controller : e.owner === 'opponents' ? o.owner === source.controller : false) continue;
      if (e.filter && !matchesFilter(g, o, e.filter, { controller: source.controller, source, anyZone: true })) continue;
      return { node: e, source };
    }
  }
  return null;
}

function hasStaticTag(g: GameState, o: GameObject, tag: string): boolean {
  const face = faceOf(g, o);
  return [...face.abilities, ...face.keywords.flatMap((k) => k.abilities ?? [])].some((a) => a.kind === 'static' && a.effect.type === tag);
}

export function setTapped(g: GameState, id: ObjectId, tapped: boolean, events: GameEvent[]): void {
  const o = obj(g, id);
  if (o.tapped === tapped) return;
  // CR 122.1d: "If a permanent with a stun counter on it would become untapped, instead remove a stun counter from it."
  if (!tapped && (o.counters.stun ?? 0) > 0) {
    o.counters.stun!--;
    if (!o.counters.stun) delete o.counters.stun;
    events.push({ type: 'counters', object: id, counter: 'stun', delta: -1 });
    return;
  }
  o.tapped = tapped;
  events.push({ type: 'tapped', object: id, tapped });
}
