import { HAPPENED_FILTER, type HappeningKind, type ObjectFilter } from '@mtg/schema';
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
 *
 * What a question can be about — died, left, sacrificed, created … — is the schema's list (HAPPENINGS): each kind is a
 * reading of the events kept (`happened`), and a card's question is a kind and a filter on what it was about
 * (`countHappened`). The compiler reads such a question from the card's words; nothing is added here for it.
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
  (g.history ??= []).push(...entries(g, events));
}

/** What a batch of events is kept as. */
function entries(g: GameState, events: GameEvent[]): Happening[] {
  const list: Happening[] = [];
  for (const e of events) {
    if (!KEPT.has(e.type)) continue;
    if (e.type === 'moved' && !seen(g, e)) {
      // A card exiled face down: that a card was exiled, and whose — not which, nor what kind.
      if (e.to === 'exile') list.push({ e: { ...e, card: '', face: 0 }, was: { ...wasOf(g, e), types: [], subtypes: [], supertypes: [], printed: [] } });
      continue;
    }
    list.push(e.type === 'moved' || e.type === 'created' || e.type === 'sacrificed' ? { e, was: wasOf(g, e) } : { e });
  }
  return list;
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

/**
 * The turn's history, and after it what the spell or ability now resolving has done that isn't recorded yet (`fresh`):
 * an effect asks as it is carried out (CR 608.2h), so "Destroy all artifacts, then … the number of artifacts that were
 * put into graveyards from the battlefield this turn" counts the ones it has just destroyed.
 */
const all = (g: GameState, lastTurn: boolean, fresh: GameEvent[] = []): Happening[] => (lastTurn ? (g.lastHistory ?? []) : fresh.length ? [...(g.history ?? []), ...entries(g, fresh)] : (g.history ?? []));
const moves = (g: GameState, lastTurn: boolean, fresh?: GameEvent[]): Moved[] => all(g, lastTurn, fresh).filter((h): h is Moved => h.e.type === 'moved' && Boolean(h.was));
// (A melded permanent leaves as its two cards, CR 712.21: the permanent is told once, by the event not marked as the
// second card. Questions about cards — put into a graveyard, exiled — count both.)
const permanent = (h: Moved) => h.e.from === 'battlefield' && !h.e.meldPart;

/** Everything of one kind that happened this turn (or the last), in order, each with what it was about. */
export function happened(g: GameState, kind: HappeningKind, lastTurn = false, fresh?: GameEvent[]): About[] {
  switch (kind) {
    case 'died':
      return moves(g, lastTurn, fresh).filter((h) => permanent(h) && h.e.to === 'graveyard');
    case 'left':
      return moves(g, lastTurn, fresh).filter(permanent);
    case 'returned_to_hand':
      return moves(g, lastTurn, fresh).filter((h) => permanent(h) && h.e.to === 'hand');
    case 'put_into_graveyard':
      return moves(g, lastTurn, fresh).filter((h) => h.e.to === 'graveyard');
    case 'exiled':
      return moves(g, lastTurn, fresh).filter((h) => h.e.to === 'exile');
    case 'left_graveyard':
      return moves(g, lastTurn, fresh).filter((h) => h.e.from === 'graveyard');
    case 'sacrificed':
      return all(g, lastTurn, fresh).filter((h): h is About => h.e.type === 'sacrificed' && Boolean(h.was));
    case 'created':
      return all(g, lastTurn, fresh).filter((h): h is About => h.e.type === 'created' && Boolean(h.was));
  }
}

// ---------------------------------------------------------------------------
// The questions the cards ask.
// ---------------------------------------------------------------------------

/**
 * Whether what an event was about matches a filter (schema HAPPENED_FILTER), for the player asking — "you", in
 * "under your control" and "your graveyard". `card`: the card as it is printed, and never a token ("a creature card
 * was put into your graveyard"); otherwise the permanent as it last existed.
 */
export function wasMatches(was: Was, filter: ObjectFilter | undefined, you: PlayerId, card = false): boolean {
  if (card && was.token) return false;
  if (!filter) return true;
  const f = filter as Record<string, unknown>;
  // A part of the filter the history can't answer: no match, never a guess.
  if (Object.keys(f).some((k) => !HAPPENED_FILTER.includes(k))) return false;
  const types = card ? was.printed : was.types;
  const any = (v: unknown, of: string[]) => (v as string[]).some((t) => of.includes(t));
  if (f.types && !any(f.types, types)) return false;
  if (f.notTypes && any(f.notTypes, types)) return false;
  if (f.subtypes && !any(f.subtypes, was.subtypes)) return false;
  if (f.notSubtypes && any(f.notSubtypes, was.subtypes)) return false;
  if (f.supertypes && !(f.supertypes as string[]).every((t) => was.supertypes.includes(t))) return false;
  if (f.token !== undefined && Boolean(f.token) !== was.token) return false;
  for (const [whose, who] of [[f.controller, was.controller], [f.owner, was.owner]] as const) {
    if (whose === undefined) continue;
    if (whose === 'you' ? who !== you : whose === 'opponent' || whose === 'not_you' ? who === undefined || who === you : true) return false;
  }
  return true;
}

/** A card's question: a kind of happening, and what it must have been about. */
export interface Asked {
  what: HappeningKind;
  filter?: ObjectFilter;
  card?: boolean;
  lastTurn?: boolean;
}

/**
 * How many things of that kind happened this turn (or the last) — the answer to "if …", "for each …", "the number
 * of …". `fresh`: what the resolution under way has done since the history was last written.
 */
export function countHappened(g: GameState, asked: Asked, you: PlayerId, fresh?: GameEvent[]): number {
  return happened(g, asked.what, Boolean(asked.lastTurn), fresh).filter((h) => wasMatches(h.was, asked.filter, you, Boolean(asked.card))).length;
}

/** Each card or token put into a graveyard this turn, in order: the event, whose graveyard, and its card types. */
export const putIntoGraveyard = (g: GameState, lastTurn = false): { event: GameEvent; owner: PlayerId; types: string[]; token: boolean }[] =>
  happened(g, 'put_into_graveyard', lastTurn).flatMap((h) => (h.was.owner ? [{ event: h.e, owner: h.was.owner, types: h.was.printed, token: h.was.token }] : []));

/** CR 700.11: how many times a player descended this turn — a permanent card put into their graveyard from anywhere. */
export const descended = (g: GameState, player: PlayerId, lastTurn = false): number =>
  countHappened(g, { what: 'put_into_graveyard', card: true, filter: { owner: 'you', types: PERMANENT_TYPES }, lastTurn }, player);

/** How many tokens a player created this turn ("for the first time each turn": none before these). */
export const tokensCreated = (g: GameState, player: PlayerId, lastTurn = false): number => countHappened(g, { what: 'created', filter: { controller: 'you' }, lastTurn }, player);

const players = (g: GameState, lastTurn: boolean, who: (e: GameEvent) => PlayerId | undefined): PlayerId[] => [...new Set(all(g, lastTurn).flatMap((h) => who(h.e) ?? []))];

/** CR 700.13: players who committed a crime this turn. */
export const crimes = (g: GameState, lastTurn = false): PlayerId[] => players(g, lastTurn, (e) => (e.type === 'crime' ? e.player : undefined));

/** CR 701.23: players who searched their own library this turn (Archive Trap). */
export const searchedOwn = (g: GameState, lastTurn = false): PlayerId[] => players(g, lastTurn, (e) => (e.type === 'searched' && e.owner === e.player ? e.player : undefined));

/** Players who activated a loyalty ability this turn (The Chain Veil). */
export const loyaltyActivated = (g: GameState, lastTurn = false): PlayerId[] => players(g, lastTurn, (e) => (e.type === 'ability_activated' && e.loyalty ? e.player : undefined));
