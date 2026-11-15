import { isRoom, roomFace } from './rooms.js';
import { faceDownFace } from './face-down.js';
import type { CardDef, CastOptionNode, FaceDef, ObjectFilter } from '@mtg/schema';
import { RulesError, type GameEvent, type GameObject, type GameState, type ObjectId, type PlayerId, type ZoneName } from './types.js';
import { replaced, type Draw, type Move } from './instead.js';
import { DRAW_RULES, drawerPrefers } from './instead-draws.js';
import { MADNESS, MOVE_RULES, moveChooser, moveQuestion } from './instead-moves.js';
import { onEnterBattlefield } from './registry.js';
import { chars, isModified, matchesFilter, objectAbilities } from './characteristics.js';
import { addLore } from './sagas.js';
import { counterBlocked, replaceQuantity } from './quantities.js';
import { playerRule } from './player-rules.js';
import { canAttach, canEnchantPlayer } from './permanents.js';

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
  const base = printedManaValue(g, o);
  // CR 202.3e: on the stack, X is the number chosen for it.
  if (o.zone === 'stack') {
    const entry = g.stack.find((s) => s.kind === 'spell' && s.object === o.id);
    const xs = entry?.x ? (faceOf(g, o).manaCost.match(/\{X\}/g) ?? []).length : 0;
    if (xs) return base + xs * entry!.x!;
  }
  return base;
}

function printedManaValue(g: GameState, o: GameObject): number {
  // CR 718.3b: a prototyped spell or permanent; CR 709.5c: a Room's unlocked doors.
  if ((o.prototyped || o.unlocked) && !o.copyOf && (o.zone === 'battlefield' || o.zone === 'stack')) return costManaValue(faceOf(g, o).manaCost);
  const def = g.cards[(o.copyOf ?? o).card];
  // CR 712.8g: a permanent copying a melded permanent has mana value 0.
  if (o.copyOf && def?.layout === 'meld' && o.copyOf.card.startsWith('meld:')) return 0;
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

type MoveOptions = { position?: 'top' | 'bottom' | number; controller?: PlayerId; face?: number; x?: number; counters?: Record<string, number>; faceDown?: GameObject['faceDown']; tapped?: boolean; attached?: boolean; discard?: true };

/** A move that is settled — it can take place, and the replacement effects on it have had their say — and not yet made. */
interface SettledMove {
  o: GameObject;
  from: ZoneName;
  opts: MoveOptions;
  move: Move;
  auraHosts: ReturnType<typeof hostsForEnteringAura>;
  meld: GameObject['melded'];
}

/**
 * Moves an object to another zone: whether it can, what the replacement effects on it make of the move, then the move.
 * CR 400.7: it becomes a new object — zone-specific state is reset and its zone-change count increases.
 * CR 400.3: cards always go to their owner's library, hand or graveyard.
 * Returns the move as it took place (where to, and what a replacement effect added) — nothing if it stayed where it was.
 */
export function moveObject(
  g: GameState,
  id: ObjectId,
  to: ZoneName,
  events: GameEvent[],
  /**
   * `attached`: the effect says what an Aura it puts onto the battlefield is attached to, and attaches it (CR 303.4f
   * doesn't ask). `discard`: it is being discarded (CR 701.9a; madness replaces that).
   */
  opts: MoveOptions = {},
): Move | undefined {
  const settled = settleMove(g, id, to, opts);
  return settled ? makeMove(g, settled, events) : undefined;
}

/** One of several moves made as one event. */
export interface PlannedMove {
  id: ObjectId;
  to: ZoneName;
  opts?: MoveOptions;
  /** Done right before this move is made, if it is made. */
  before?: () => void;
  /** Done right after it — or after it turned out not to be made. */
  then?: (move: Move | undefined) => void;
}

/** The permanents entering the battlefield in the event being carried out, when several enter at once. */
let alongside: ReadonlySet<ObjectId> | undefined;

/** CR 614.12: whether this permanent is entering at the same time as the one whose entering is being settled. */
export const entersAlongside = (id: ObjectId): boolean => alongside?.has(id) ?? false;

/**
 * Moves several objects at once (CR 704.3: state-based actions; CR 608.2c, 101.4: an effect that destroys, sacrifices,
 * exiles or returns them all): what the replacement effects make of each move is settled as the game stands before
 * any of them moves. An effect whose permanent leaves with the others applies to them all the same (Kalitas dying
 * with an opponent's creatures); one whose permanent enters with the others doesn't yet (CR 614.12: Containment
 * Priest returned with them).
 */
export function moveTogether(g: GameState, moves: PlannedMove[], events: GameEvent[]): void {
  const settled = moves.map((planned) => ({ planned, move: settleMove(g, planned.id, planned.to, planned.opts ?? {}) }));
  const was = alongside;
  alongside = new Set(settled.filter(({ move }) => move && move.move.to === 'battlefield' && move.from !== 'battlefield').map(({ planned }) => planned.id));
  try {
    for (const { planned, move } of settled) {
      // (One that another's move has taken along already — a melded permanent's other card — is where it goes.)
      if (!move || move.o.zone !== move.from) {
        planned.then?.(undefined);
        continue;
      }
      planned.before?.();
      const made = makeMove(g, move, events);
      planned.then?.(made);
    }
  } finally {
    alongside = was;
  }
}

/** Parts 1 and 2 of a move: whether it can take place, and what the replacement effects on it make of it. Changes nothing. */
function settleMove(g: GameState, id: ObjectId, to: ZoneName, opts: MoveOptions): SettledMove | undefined {
  const o = obj(g, id);
  const from = o.zone;
  // 1. Whether it can move at all.
  // CR 111.8: a token that has left the battlefield can't move to another zone or come back — it stays where it is
  // (and ceases to exist the next time state-based actions are checked). "Exile it, then return it" loses a token.
  if (o.token && from !== 'battlefield' && from !== 'stack') return undefined;
  // CR 303.4f: an Aura put onto the battlefield without being cast — its controller chooses what it enchants as it
  // enters (asked right after, before anyone can act). CR 303.4g: with nothing it could enchant, it stays where it is.
  const auraHosts = to === 'battlefield' && from !== 'stack' && from !== 'battlefield' && !opts.faceDown && !opts.attached ? hostsForEnteringAura(g, o, opts.controller ?? o.controller, opts.face ?? 0) : undefined;
  if (auraHosts && !auraHosts.hosts.length && !auraHosts.players.length) return undefined;
  // CR 712.21: a melded permanent leaving the battlefield — one permanent leaves, and both its cards go to the new zone.
  const meld = from === 'battlefield' ? o.melded : undefined;
  // Grafdigger's Cage: "Creature cards in graveyards and libraries can't enter the battlefield." — it stays where it is.
  if (to === 'battlefield' && (from === 'graveyard' || from === 'library') && enteringBanned(g, o, from)) return undefined;
  // 2. What the replacement effects on it make of the move (CR 614.1a, 616.1): where it goes instead, and what goes
  //    with that. Each is a rule in instead-moves.ts; none is known here.
  const asked: Move = { kind: 'move', object: o, from, to, ...(opts.position !== undefined ? { position: opts.position } : {}), ...(opts.discard ? { discard: true } : {}), also: [] };
  const move = replaced(g, asked, MOVE_RULES, { by: moveChooser(asked), about: () => moveQuestion(g, asked) }) ?? asked;
  if (move.position !== opts.position) {
    const { position: _was, ...rest } = opts;
    opts = { ...rest, ...(move.position !== undefined ? { position: move.position } : {}) };
  }
  return { o, from, opts, move, auraHosts, meld };
}

/** Part 3 of a move: the move itself, as settled. */
function makeMove(g: GameState, settled: SettledMove, events: GameEvent[]): Move {
  const { o, from, opts, move, auraHosts, meld } = settled;
  const id = o.id;
  const to = move.to;
  delete o.exileOnLeave;
  // CR 400.7: a new object.
  delete o.becameAura;
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
      // Essence Sliver: "its controller gains that much life" after the Sliver died in that combat.
      controller: o.controller,
      // CR 603.10a: "Whenever a creature with a +1/+1 counter on it dies", "a modified creature" — as it last existed.
      ...(Object.keys(o.counters).length ? { counters: { ...o.counters } } : {}),
      ...(isModified(g, o) ? { modified: true } : {}),
      ...attachmentKinds(g, o),
      types: [...c.types],
      subtypes: [...c.subtypes],
      // Choking Sands: "If that land was nonbasic".
      ...(c.supertypes.length ? { supertypes: [...c.supertypes] } : {}),
      // Filigree Fracture: "If that permanent was blue or black".
      ...(c.colors.length ? { colors: [...c.colors] } : {}),
      // Wilhelt, the Rotcleaver: "if it didn't have decayed".
      ...(c.keywords.length ? { keywords: [...new Set(c.keywords.map((k) => k.id))] } : {}),
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
  // CR 903.9a: a commander put into a graveyard or into exile may go on to the command zone — a state-based action:
  // its owner is asked the next time they are checked. (One that would go to its owner's hand or library may go to
  // the command zone instead, CR 903.9b: a replacement effect, settled with the others before the move.)
  if (o.commander && !o.token && (to === 'graveyard' || to === 'exile')) (g.commanderReturns ??= []).push({ id, zcc: o.zcc });
  // CR 400.7a: effects from spells and abilities that changed a spell on the stack (Rivaz of the Claw: "it gains 'When
  // this creature dies, exile it.'") continue to apply to the permanent it becomes.
  if (from === 'stack' && to === 'battlefield') {
    for (const e of g.effects) for (const r of e.objects) if (r.id === id && r.zcc === o.zcc - 1) r.zcc = o.zcc;
  }
  o.tapped = false;
  o.damage = 0;
  o.counters = {};
  delete o.counterStamps;
  o.sick = to === 'battlefield';
  // CR 613.7d: an object receives a timestamp as it enters a zone.
  o.timestamp = ++g.clock;
  if (to === 'battlefield') o.arrived = o.timestamp;
  delete o.loyaltyActivatedTurn;
  delete o.loyaltyActivations;
  delete o.unsized;
  delete o.handPT;
  // CR 400.7: a new object hasn't been dealt damage this turn.
  delete o.damagedTurn;
  // Grafted Exoskeleton: an Equipment that leaves the battlefield becomes unattached as it does.
  if (from === 'battlefield' && o.attachedTo) events.push({ type: 'unattached', object: o.id, from: o.attachedTo.id, fromZcc: o.attachedTo.zcc });
  delete o.attachedTo;
  delete o.attachedToPlayer;
  // CR 707.10f: a copy of a permanent spell enters as a token with the copy's values (Storm of Saruman's "isn't legendary").
  if (!(from === 'stack' && to === 'battlefield' && o.token)) delete o.copyOf;
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
  delete o.suspected;
  delete o.solved;
  delete o.pairedWith;
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
  delete o.harnessed;
  delete o.chosen;
  delete o.devoured;
  delete o.melded;
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
  // What a replacement effect added to the move: "… with a void counter on it", "… and you gain 2 life".
  for (const more of move.also) if (!more.late) more.run(g, o, events);

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
    // (Melira, Sylvok Outcast: persist's -1/-1 counter isn't put on a creature that can't have it.)
    for (const [counter, n] of Object.entries(opts.counters ?? {})) if (!counterBlocked(g, o, counter)) o.counters[counter] = (o.counters[counter] ?? 0) + n;
    // Opal Palace's mana: the commander enters with its additional counters (CR 122.6).
    // CR 614.1a: "enters with" counters are counters put on it (Doubling Season, Hardened Scales, Vorinclex).
    const entering = (counter: string, n: number) => replaceQuantity(g, 'counters', n, { player: o.controller, object: o, counter });
    for (const [counter, n] of Object.entries(castInfo?.enterCounters ?? {})) o.counters[counter] = (o.counters[counter] ?? 0) + entering(counter, n);
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
    // Solar Array: "that spell gains sunburst" — an effect on the spell that goes on applying to the permanent (CR 400.7a).
    const grantedSunburst = g.effects.some((e) => e.keywords?.some((k) => k.id === 'sunburst') && e.objects.some((r) => r.id === id && r.zcc === o.zcc));
    if ((face.keywords.some((k) => k.id === 'sunburst') || grantedSunburst) && o.cast?.colors) {
      const kind = face.types.includes('Creature') ? '+1/+1' : 'charge';
      o.counters[kind] = (o.counters[kind] ?? 0) + entering(kind, o.cast.colors);
    }
    // CR 306.5b: a planeswalker enters with loyalty counters equal to its printed loyalty.
    // CR 702.150a: compleated — two fewer for each Phyrexian mana symbol life was paid for.
    const compleated = face.keywords.some((k) => k.id === 'compleated') && !castInfo?.copy ? 2 * (castInfo?.phyrexianLife ?? 0) : 0;
    if (face.loyalty !== undefined && /^\d+$/.test(face.loyalty)) o.counters.loyalty = entering('loyalty', Math.max(0, Number(face.loyalty) - compleated));
    // CR 310.4b: a battle enters with defense counters equal to its printed defense.
    if (face.defense !== undefined && /^\d+$/.test(face.defense)) o.counters.defense = entering('defense', Number(face.defense));
    // CR 122.6: entering with counters is having them put on it (Sigardian Paladin, Fairgrounds Trumpeter).
    if ((o.counters['+1/+1'] ?? 0) > 0) notePlusCounters(g, o, o.controller);
    onEnterBattlefield(g, o, events);
    if (auraHosts && o.zone === 'battlefield') (g.asEnters ??= []).push({ object: o.id, zcc: o.zcc, node: { type: 'as_enters', choice: 'enchant' }, ...auraHosts });
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
    ...(to === 'battlefield' && g.resolving?.entry.kind === 'ability' ? { by: { ...g.resolving.entry.source } } : {}),
  });
  if (meld) {
    o.card = meld.own;
    releaseMeldPartner(g, o, meld.partner, to, opts.position, controllerBefore, events);
  }
  // CR 714.3a: a Saga enters with a lore counter on it.
  if (to === 'battlefield') addLore(g, o, events, true);
  for (const more of move.also) if (more.late) more.run(g, o, events);
  return move;
}

/**
 * CR 303.4f: what an Aura card about to be put onto the battlefield (not as a resolving spell) could enchant, as
 * `controller` will control it — undefined for anything that isn't an Aura. An Aura can't enchant something entering
 * at the same time: permanents this resolution has just put onto the battlefield aren't offered.
 */
function hostsForEnteringAura(g: GameState, o: GameObject, controller: PlayerId, faceIndex: number): { hosts: { id: ObjectId; zcc: number }[]; players: PlayerId[] } | undefined {
  const def = g.cards[o.card];
  const face = def?.faces[faceIndex] ?? def?.faces[0];
  if (!face?.subtypes.includes('Aura')) return undefined;
  const enchant = face.keywords.find((k) => k.id === 'enchant' && (k.filter || k.player));
  if (!enchant) return undefined;
  // As it will be: on the battlefield, under that player's control.
  const entering: GameObject = { ...o, controller, face: faceIndex };
  if (enchant.player) return { hosts: [], players: livePlayers(g).filter((p) => canEnchantPlayer(g, entering, p)) };
  const together = new Set((g.resolving?.moves ?? []).filter((m) => m.to === 'battlefield').map((m) => m.id));
  const zone = enchant.filter!.zone;
  const pool = zone === 'graveyard' ? Object.values(g.zones.graveyard).flat() : zone && zone !== 'battlefield' ? [] : g.zones.battlefield;
  return { hosts: pool.filter((id) => id !== o.id && !together.has(id) && canAttach(g, entering, g.objects[id]!)).map((id) => ({ id, zcc: g.objects[id]!.zcc })), players: [] };
}

/** CR 712.21: the other card of a melded permanent that left the battlefield, put into the same zone as a new object. */
function releaseMeldPartner(g: GameState, a: GameObject, partner: ObjectId, to: ZoneName, position: 'top' | 'bottom' | number | undefined, controller: PlayerId, events: GameEvent[]): void {
  const b = g.objects[partner];
  if (!b || b.meldedInto !== a.id || to === 'stack' || to === 'battlefield') return;
  delete b.meldedInto;
  b.zone = to;
  b.zcc++;
  b.face = 0;
  b.controller = b.owner;
  b.tapped = false;
  b.damage = 0;
  b.counters = {};
  b.sick = false;
  b.timestamp = ++g.clock;
  delete b.baseController;
  delete b.arrived;
  const list = zoneList(g, to, b.owner);
  // CR 712.21a: put into a library or graveyard together, in an order its owner picks (here: beside the other card).
  const at = list.indexOf(a.id);
  if (to === 'library' && position !== 'bottom' && at >= 0) list.splice(at, 0, b.id);
  else list.push(b.id);
  if (g.resolving && to !== 'library' && to !== 'hand') (g.resolving.found ??= {})[b.id] = b.zcc;
  events.push({ type: 'moved', object: b.id, from: 'battlefield', to, controller, card: b.card, face: 0, meldPart: true });
}

/**
 * CR 712.4a: "you both own and control ~ and a creature named …" — the permanents that could be melded with `self`: the
 * named counterpart, owned and controlled by `you` (Mishra, Claimed by Gix: and attacking, as `self` must be).
 */
export function meldPartners(g: GameState, self: GameObject, spec: { partner?: unknown; partnerTypes?: unknown; attacking?: unknown }, you: PlayerId): GameObject[] {
  const attacking = (o: GameObject) => g.combat?.attackers[o.id]?.zcc === o.zcc;
  const mine = (o: GameObject) => o.zone === 'battlefield' && o.owner === you && o.controller === you && !o.phasedOut && (!spec.attacking || attacking(o));
  if (!mine(self) || typeof spec.partner !== 'string') return [];
  const types = (spec.partnerTypes as string[] | undefined) ?? [];
  return g.zones.battlefield.flatMap((id) => {
    const o = g.objects[id]!;
    if (o === self || !mine(o) || nameOf(g, o) !== spec.partner) return [];
    const c = chars(g, o);
    return types.every((t) => c.types.includes(t)) ? [o] : [];
  });
}

/**
 * CR 701.42a / 712.4a: puts two exiled meld cards onto the battlefield combined, as one permanent with the combined back
 * face (`card`, a key into the game's cards) under `controller`'s control. `a` becomes that permanent; `b` is kept off every
 * zone list as its other card. If the permanent doesn't enter (it's exiled instead), both cards stay in exile.
 */
export function meldCards(g: GameState, a: GameObject, b: GameObject, card: string, controller: PlayerId, events: GameEvent[], opts: { tapped?: boolean } = {}): boolean {
  const own = a.card;
  removeFromCurrentZone(g, b);
  b.zone = 'battlefield';
  b.meldedInto = a.id;
  b.controller = controller;
  a.card = card;
  a.face = 0;
  moveObject(g, a.id, 'battlefield', events, { controller, ...(opts.tapped ? { tapped: true } : {}) });
  if (a.zone === 'battlefield') {
    a.melded = { own, partner: b.id };
    b.zcc++;
    return true;
  }
  a.card = own;
  delete b.meldedInto;
  b.zone = 'exile';
  b.controller = b.owner;
  zoneList(g, 'exile', b.owner).push(b.id);
  return false;
}

/** The zone-change count an object had (or has) on the battlefield: now if it's there, else as it left. */
/**
 * CR 702.95b: the creature this one is paired with (soulbond), if they're still paired — both on the battlefield, as the
 * objects they were, under one controller (CR 702.95e; whether both are still creatures is checked with the state-based
 * actions).
 */
export function pairedPartner(g: GameState, o: GameObject): GameObject | undefined {
  const r = o.pairedWith;
  if (!r || o.zone !== 'battlefield') return undefined;
  const p = g.objects[r.id];
  if (!p || p.zcc !== r.zcc || p.zone !== 'battlefield' || p.controller !== o.controller) return undefined;
  return p.pairedWith?.id === o.id && p.pairedWith.zcc === o.zcc ? p : undefined;
}

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
  const move = moveObject(g, id, 'graveyard', events, { discard: true });
  const madness = Boolean(move?.also.some((a) => a.key === MADNESS));
  events.push({ type: 'discarded', object: id, player: o.owner, ...(madness && o.zone === 'exile' ? { madness: true as const } : {}) });
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

/**
 * Draws one card: whether the player can, what the replacement effects on a draw make of it (instead-draws.ts) — two
 * cards, another player's draw, the game won — then the draw.
 * CR 704.5b / 104.3c: drawing from an empty library is recorded for state-based actions.
 * `part`: this draw is part of one that effects have replaced already — the ones that applied (CR 614.5: they don't
 * again), and whether it is still the first card the player draws in their draw step.
 */
export function drawCard(g: GameState, player: PlayerId, events: GameEvent[], part?: { applied: Set<string>; first: boolean }): void {
  // CR 121.2: a draw that can't happen doesn't (Narset) — it isn't a draw from an empty library either.
  // Maralen of the Mornsong: "Players can't draw cards."
  if (drawLimited(g, player) || playerRule(g, player, 'cant_draw')) return;
  const inDrawStep = g.step === 'draw' && g.active === player;
  const first = part ? part.first : inDrawStep && !(g.turnLog.drawStepDrew ?? []).includes(player);
  const applied = part?.applied ?? new Set<string>();
  const asked: Draw = { kind: 'draw', player, n: 1, first };
  const draw = replaced(g, asked, DRAW_RULES, { prefer: drawerPrefers(player) }, applied) ?? asked;
  if (inDrawStep && draw.player === player) {
    const drew = (g.turnLog.drawStepDrew ??= []);
    if (!drew.includes(player)) drew.push(player);
  }
  if (draw.wins) {
    g.players[draw.player]!.wonByEffect = true;
    return;
  }
  // Replaced: each card of what it became is drawn in turn (CR 121.2), by whoever draws it now.
  if (draw.player !== player || draw.n !== 1) {
    for (let i = 0; i < draw.n; i++) drawCard(g, draw.player, events, { applied, first: first && draw.player === player && i === 0 });
    return;
  }
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
  ((g.turnLog.drawnIds ??= {})[player] ??= []).push(top);
  const firstCard = inDrawStep && !g.turnLog.drawStepCards;
  if (inDrawStep) g.turnLog.drawStepCards = (g.turnLog.drawStepCards ?? 0) + 1;
  events.push({ type: 'drew', player, object: top, nth: drawn[player], ...(firstCard ? { firstInDrawStep: true as const } : {}) });
}

/** Grafdigger's Cage, Soulless Jailer, Kunoros: cards like this in these zones can't enter the battlefield. */
export function enteringBanned(g: GameState, o: GameObject, from: ZoneName): boolean {
  return abilitySources(g).some((id) => {
    const source = g.objects[id]!;
    return objectAbilities(g, source).some((a) => {
      if (a.kind !== 'static' || a.effect.type !== 'cant_enter') return false;
      const e = a.effect as unknown as { filter?: ObjectFilter; fromZones?: ZoneName[] };
      return (!e.fromZones || e.fromZones.includes(from)) && (!e.filter || matchesFilter(g, o, e.filter, { controller: source.controller, source, anyZone: true }));
    });
  });
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

/** Koll, the Forgemaster: "if it was enchanted or equipped" — what was attached to it as it left (CR 603.10a). */
function attachmentKinds(g: GameState, o: GameObject): { enchanted?: true; equipped?: true } {
  const out: { enchanted?: true; equipped?: true } = {};
  for (const id of g.zones.battlefield) {
    const a = g.objects[id]!;
    if (a.id === o.id || a.attachedTo?.id !== o.id || a.attachedTo.zcc !== o.zcc) continue;
    const sub = chars(g, a).subtypes;
    if (sub.includes('Aura')) out.enchanted = true;
    if (sub.includes('Equipment')) out.equipped = true;
  }
  return out;
}

/** "if a +1/+1 counter was put on a permanent under your control this turn", "you've put … on a creature this turn". */
export function notePlusCounters(g: GameState, o: GameObject, by: PlayerId | undefined): void {
  const log = g.turnLog;
  if (!(log.plusCountersOn ??= []).includes(o.controller)) log.plusCountersOn.push(o.controller);
  if (by && chars(g, o).types.includes('Creature') && !(log.plusCountersBy ??= []).includes(by)) log.plusCountersBy.push(by);
}
