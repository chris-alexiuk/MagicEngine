import type { GameEvent, GameState, ObjectId, PlayerId, ZoneName } from './types.js';

/**
 * What happened this turn, kept once: each event a "this turn" question can be about, with what it was about as it
 * then was (CR 603.10a: what left the battlefield, as it last existed there; CR 608.2h). "If a creature died this
 * turn", "for each permanent you sacrificed this turn", "if a card left your graveyard this turn" are questions asked
 * of this one history — a new one of their kind needs nothing recorded for it as the game goes.
 *
 * (The turn log in conditions.ts keeps what is a sum, a mark on an object, or a "first time this turn" — life, damage,
 * spells cast, attacks, what entered. The questions about what moved, was made, was sacrificed or was done by a player
 * are asked here.)
 *
 * Nothing here is hidden information, so every player's view of the game carries it whole: a move is kept with the
 * card it was only if all players saw that card at one end of it. A card exiled face down is kept as that and no
 * more; a move no one sees the card of — a draw, a card put back, a spell or permanent turned face down — isn't kept.
 *
 * An entry is never changed once recorded: the states of a game share them (actions.ts), each with its own list.
 */

/** What an event was about, as it then was. */
export interface Was {
  id: ObjectId;
  /** Who controlled it: for what left the battlefield, its last controller; for a sacrifice, who sacrificed it. */
  controller: PlayerId;
  /** Its owner — unknown for something that had ceased to exist before the event was recorded. */
  owner?: PlayerId;
  token: boolean;
  /** Its card types as it last existed on the battlefield, for what was there; else as its card is printed. */
  types: string[];
  subtypes: string[];
  supertypes: string[];
  /** Its card types as printed on the face it showed (a land that was a creature is still printed a Land). */
  printed: string[];
}

/** One thing that happened: the event, and what it was about. */
export interface Happening {
  e: GameEvent;
  was?: Was;
}

/** The kinds of event kept: those the questions below are asked of. */
const KEPT: ReadonlySet<GameEvent['type']> = new Set(['moved', 'created', 'sacrificed', 'crime', 'searched', 'ability_activated']);

/** Records a batch of events in the turn's history — once, as they are collected (triggers.ts). */
export function recordHistory(g: GameState, events: GameEvent[]): void {
  for (const e of events) {
    if (!KEPT.has(e.type)) continue;
    const list = (g.history ??= []);
    if (e.type === 'moved' && !seen(g, e)) {
      // A card exiled face down: that a card was exiled, and whose — not which, nor what kind.
      if (e.to === 'exile') list.push({ e: { ...e, card: '', face: 0 }, was: { ...wasOf(g, e), types: [], subtypes: [], supertypes: [], printed: [] } });
      continue;
    }
    list.push(e.type === 'moved' || e.type === 'created' || e.type === 'sacrificed' ? { e, was: wasOf(g, e) } : { e });
  }
}

const SEEN_ZONES: readonly ZoneName[] = ['battlefield', 'graveyard', 'command'];
const HIDDEN_ZONES: readonly ZoneName[] = ['hand', 'library'];

/**
 * Whether all players saw which card moved: it left a zone where cards are seen, or arrived face up in one.
 * (CR 708.9: a face-down permanent that leaves the battlefield is revealed.)
 */
function seen(g: GameState, e: Extract<GameEvent, { type: 'moved' }>): boolean {
  if (SEEN_ZONES.includes(e.from)) return true;
  const o = g.objects[e.object];
  // Face down where it now is (CR 708.2), or exiled so that only one player may look at it.
  if (o && (o.faceDown || (o.zone === 'exile' && (o.hiddenFor !== undefined || o.foretold !== undefined)))) return false;
  // Into a hand or a library: seen if it came off the stack, not if it came from a hand, a library or exile.
  if (HIDDEN_ZONES.includes(e.to)) return e.from === 'stack';
  return true;
}

function wasOf(g: GameState, e: Extract<GameEvent, { type: 'moved' | 'created' | 'sacrificed' }>): Was {
  const o = g.objects[e.object];
  const lk = g.lastKnown?.[e.object];
  if (e.type === 'moved') {
    const face = g.cards[e.card]?.faces[e.face];
    const printed = face?.types ?? [];
    // What left the battlefield is asked about as it last existed there; anything else, as the card it is.
    const there = e.from === 'battlefield' ? lk : undefined;
    return {
      id: e.object,
      controller: e.controller,
      ...(o ? { owner: o.owner } : {}),
      token: Boolean(e.token),
      types: [...(there?.types ?? printed)],
      subtypes: [...(e.from === 'battlefield' ? (lk?.subtypes ?? []) : (face?.subtypes ?? []))],
      supertypes: [...(there?.supertypes ?? face?.supertypes ?? [])],
      printed: [...printed],
    };
  }
  const face = o ? g.cards[o.card]?.faces[o.face ?? 0] : undefined;
  const printed = face?.types ?? [];
  // What was sacrificed, as it last existed; what was created, as it was made.
  const last = e.type === 'sacrificed' ? lk : undefined;
  return {
    id: e.object,
    controller: e.type === 'sacrificed' ? e.player : e.controller,
    ...(o ? { owner: o.owner } : {}),
    token: Boolean(o?.token),
    types: [...(last?.types ?? printed)],
    subtypes: [...(last?.subtypes ?? face?.subtypes ?? [])],
    supertypes: [...(last?.supertypes ?? face?.supertypes ?? [])],
    printed: [...printed],
  };
}

/** A turn begins: this turn's history becomes the last turn's. */
export function turnHistory(g: GameState): void {
  g.lastHistory = g.history ?? [];
  g.history = [];
}

type About = Happening & { was: Was };
type Moved = About & { e: Extract<GameEvent, { type: 'moved' }> };
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

const all = (g: GameState, lastTurn: boolean): Happening[] => (lastTurn ? g.lastHistory : g.history) ?? [];
const moves = (g: GameState, lastTurn: boolean): Moved[] => all(g, lastTurn).filter((h): h is Moved => h.e.type === 'moved' && Boolean(h.was));
// (A melded permanent leaves as its two cards, CR 712.21: the permanent is told once, by the event not marked as the
// second card. Questions about cards — put into a graveyard, exiled — count both.)
const permanent = (h: Moved) => h.e.from === 'battlefield' && !h.e.meldPart;

/**
 * What a question can be about. Each is a reading of the events kept; nothing is recorded for it.
 *   died               a permanent put into a graveyard from the battlefield (CR 700.4)
 *   left               a permanent that left the battlefield
 *   returned_to_hand   a permanent put into a hand from the battlefield
 *   put_into_graveyard a card or token put into a graveyard from anywhere
 *   exiled             a card or token put into exile from anywhere
 *   left_graveyard     a card that left a graveyard
 *   sacrificed         a permanent sacrificed
 *   created            a token created
 */
export const HAPPENINGS = ['died', 'left', 'returned_to_hand', 'put_into_graveyard', 'exiled', 'left_graveyard', 'sacrificed', 'created'] as const;
export type HappeningKind = (typeof HAPPENINGS)[number];

/** Everything of one kind that happened this turn (or the last), in order, each with what it was about. */
export function happened(g: GameState, kind: HappeningKind, lastTurn = false): About[] {
  switch (kind) {
    case 'died':
      return moves(g, lastTurn).filter((h) => permanent(h) && h.e.to === 'graveyard');
    case 'left':
      return moves(g, lastTurn).filter(permanent);
    case 'returned_to_hand':
      return moves(g, lastTurn).filter((h) => permanent(h) && h.e.to === 'hand');
    case 'put_into_graveyard':
      return moves(g, lastTurn).filter((h) => h.e.to === 'graveyard');
    case 'exiled':
      return moves(g, lastTurn).filter((h) => h.e.to === 'exile');
    case 'left_graveyard':
      return moves(g, lastTurn).filter((h) => h.e.from === 'graveyard');
    case 'sacrificed':
      return all(g, lastTurn).filter((h): h is About => h.e.type === 'sacrificed' && Boolean(h.was));
    case 'created':
      return all(g, lastTurn).filter((h): h is About => h.e.type === 'created' && Boolean(h.was));
  }
}

// ---------------------------------------------------------------------------
// The questions the cards ask.
// ---------------------------------------------------------------------------

const distinct = <T>(list: T[]): T[] => [...new Set(list)];

/** What died this turn, as it last existed ("for each creature that died this turn"). */
export const died = (g: GameState, lastTurn = false): Was[] => happened(g, 'died', lastTurn).map((h) => h.was);

/** "If a creature died this turn" (morbid) — a creature as it last existed, or a creature card. */
export const creatureDied = (g: GameState, lastTurn = false): boolean => died(g, lastTurn).some((w) => w.types.includes('Creature') || w.printed.includes('Creature'));

/** What left the battlefield this turn, as it last existed (revolt; Kutzil's Flanker). */
export const leftBattlefield = (g: GameState, lastTurn = false): Was[] => happened(g, 'left', lastTurn).map((h) => h.was);

/** "If a nonland permanent left the battlefield this turn" (void) — by the card it was. */
export const nonlandLeft = (g: GameState, lastTurn = false): boolean => leftBattlefield(g, lastTurn).some((w) => !w.printed.includes('Land'));

/** "If one or more cards were put into exile this turn" (a token isn't a card). */
export const cardExiled = (g: GameState, lastTurn = false): boolean => happened(g, 'exiled', lastTurn).some((h) => !h.was.token);

/** Players who had a permanent put into their hand from the battlefield this turn (Barrin). */
export const returnedToHand = (g: GameState, lastTurn = false): PlayerId[] => distinct(happened(g, 'returned_to_hand', lastTurn).flatMap((h) => (h.was.owner ? [h.was.owner] : [])));

/** Each card that left a graveyard this turn: whose, and its card types (Gau, Feral Youth). */
export const leftGraveyard = (g: GameState, lastTurn = false): { owner: PlayerId; types: string[] }[] =>
  happened(g, 'left_graveyard', lastTurn).flatMap((h) => (h.was.owner ? [{ owner: h.was.owner, types: h.was.printed }] : []));

/** Each card or token put into a graveyard this turn, in order: the event, whose graveyard, and its card types. */
export const putIntoGraveyard = (g: GameState, lastTurn = false): { event: GameEvent; owner: PlayerId; types: string[]; token: boolean }[] =>
  happened(g, 'put_into_graveyard', lastTurn).flatMap((h) => (h.was.owner ? [{ event: h.e, owner: h.was.owner, types: h.was.printed, token: h.was.token }] : []));

/** CR 700.11: how many times a player descended this turn — a permanent card put into their graveyard from anywhere. */
export const descended = (g: GameState, player: PlayerId, lastTurn = false): number =>
  putIntoGraveyard(g, lastTurn).filter((c) => !c.token && c.owner === player && PERMANENT_TYPES.some((t) => c.types.includes(t))).length;

/** What was sacrificed this turn, as it last existed (Elanor Gardner) — by one player, or by anyone. */
export const sacrificed = (g: GameState, player?: PlayerId, lastTurn = false): Was[] =>
  happened(g, 'sacrificed', lastTurn)
    .map((h) => h.was)
    .filter((w) => player === undefined || w.controller === player);

/** How many tokens a player created this turn (Thalisse; Idol of Oblivion). */
export const tokensCreated = (g: GameState, player: PlayerId, lastTurn = false): number => happened(g, 'created', lastTurn).filter((h) => h.was.controller === player).length;

const players = (g: GameState, lastTurn: boolean, who: (e: GameEvent) => PlayerId | undefined): PlayerId[] => distinct(all(g, lastTurn).flatMap((h) => who(h.e) ?? []));

/** CR 700.13: players who committed a crime this turn. */
export const crimes = (g: GameState, lastTurn = false): PlayerId[] => players(g, lastTurn, (e) => (e.type === 'crime' ? e.player : undefined));

/** CR 701.23: players who searched their own library this turn (Archive Trap). */
export const searchedOwn = (g: GameState, lastTurn = false): PlayerId[] => players(g, lastTurn, (e) => (e.type === 'searched' && e.owner === e.player ? e.player : undefined));

/** Players who activated a loyalty ability this turn (The Chain Veil). */
export const loyaltyActivated = (g: GameState, lastTurn = false): PlayerId[] => players(g, lastTurn, (e) => (e.type === 'ability_activated' && e.loyalty ? e.player : undefined));
