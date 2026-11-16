import { HAPPENED_FILTER, type Color, type HappeningKind, type KeywordInstance, type ObjectFilter } from '@mtg/schema';
import { chars, matchesFilter, type Characteristics, type FilterContext } from './characteristics.js';
import type { GameEvent, GameObject, GameState, ObjectId, PlayerId, ZoneName } from './types.js';
import { manaValueOf } from './zones.js';

/**
 * What happened this turn, kept once: each event a "this turn" question can be about, with what it was about as it
 * then was (CR 603.10a: what left the battlefield, as it last existed there; CR 608.2h). "If a creature died this
 * turn", "for each permanent you sacrificed this turn", "if a card left your graveyard this turn" are questions asked
 * of this one history — a new one of their kind needs nothing recorded for it as the game goes.
 *
 * So are the questions about spells cast and about life: each cast is kept with the spell as it was cast, in the order
 * they were cast (storm, CR 702.40a: "each spell cast before it this turn"; "your second spell each turn"; "if you've
 * cast another blue spell this turn"), each gain or loss of life as it happened — and how many, how much and who are
 * worked out when asked.
 *
 * (The turn log in conditions.ts keeps the rest for now: damage, attacks and discards, marks on objects — what entered,
 * what was targeted — and once-a-turn permissions used.)
 *
 * Nothing here is hidden information, so every player's view of the game carries it whole: a move is kept with the
 * card it was only if all players saw that card at one end of it. A card exiled face down is kept as that and no
 * more; a move no one sees the card of — a draw, a card put back, a spell or permanent turned face down — isn't kept;
 * a spell cast face down is kept as what it showed, a 2/2 creature spell with no name.
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
  /** Its card types as it last existed on the battlefield, for what was there; a spell's, on the stack; else as its card is printed. */
  types: string[];
  subtypes: string[];
  supertypes: string[];
  /** Its card types as printed on the face it showed (a land that was a creature is still printed a Land). */
  printed: string[];
  /** Which object it was (CR 400.7: one that changes zones is a new object) — kept for a spell cast. */
  zcc?: number;
}

/** A spell as it was cast: what a question later in the turn is told of it, whatever has become of the card since. */
export interface SpellWas {
  name: string;
  colors: string[];
  power: number;
  toughness: number;
  hasPT: boolean;
  keywords: { id: string; text?: string }[];
  /** Its mana value on the stack (CR 202.3e: with X as chosen). */
  mv: number;
  /** Where it was cast from. */
  from?: ZoneName;
  /** CR 702.185: cast for its warp cost. */
  warped?: true;
  /**
   * The object it was on the stack, for whatever else a filter asks of it — kept for a spell cast face up, which
   * everyone saw. (What a face-down spell is, no one is told: CR 708.4.)
   */
  object?: GameObject;
}

/** One thing that happened: the event, and what it was about. */
export interface Happening {
  e: GameEvent;
  /** What moved, was made or was sacrificed; the spell cast. */
  was?: Was;
  /** A spell cast. */
  spell?: SpellWas;
}

/**
 * Records a batch of events in the turn's history — once, as they are collected (triggers.ts), in the order they
 * happened. What an event is told by its place in the turn is marked on it here, for the triggers about to be matched:
 * a spell as its caster's first, second … of the turn, with the mana they had spent on spells before it (CR 700.14);
 * a gain or loss of life as that player's first of the turn.
 */
export function recordHistory(g: GameState, events: GameEvent[]): void {
  const list = (g.history ??= []);
  for (const h of entries(g, events)) {
    const e = h.e;
    if (e.type === 'cast') {
      let nth = 1;
      let spent = 0;
      for (const x of list) {
        if (x.e.type !== 'cast' || x.e.player !== e.player) continue;
        nth++;
        spent += x.e.manaSpent ?? 0;
      }
      e.nth = nth;
      e.manaBefore = spent;
    }
    if (e.type === 'life' && e.delta !== 0) {
      const before = list.some((x) => x.e.type === 'life' && x.e.player === e.player && Math.sign(x.e.delta) === Math.sign(e.delta));
      if (!before && e.delta > 0) e.firstGain = true;
      if (!before && e.delta < 0) e.firstLoss = true;
    }
    list.push(h);
  }
}

/** What a batch of events is kept as. (Events of no kind listed here aren't kept: no question is asked of them.) */
function entries(g: GameState, events: GameEvent[]): Happening[] {
  const list: Happening[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'moved':
        if (seen(g, e)) list.push({ e, was: wasOf(g, e) });
        // A card exiled face down: that a card was exiled, and whose — not which, nor what kind.
        else if (e.to === 'exile') list.push({ e: { ...e, card: '', face: 0 }, was: { ...wasOf(g, e), types: [], subtypes: [], supertypes: [], printed: [] } });
        break;
      case 'created':
      case 'sacrificed':
        list.push({ e, was: wasOf(g, e) });
        break;
      case 'cast':
        list.push({ e, ...asCast(g, e) });
        break;
      case 'life':
      case 'crime':
      case 'searched':
      case 'ability_activated':
        list.push({ e });
        break;
    }
  }
  return list;
}

/** An object as it is now: what a question later in the turn is told it was. */
function asItIs(g: GameState, o: GameObject, c: Characteristics, controller: PlayerId = o.controller): Was {
  // (A copy is printed as what it copies, CR 707.2. A face-down object shows no card: what it is printed as is no one's
  // to know.)
  const at = o.copyOf ?? { card: o.card, face: o.face ?? 0 };
  const face = g.cards[at.card]?.faces[at.face];
  return { id: o.id, zcc: o.zcc, controller, owner: o.owner, token: Boolean(o.token), types: [...c.types], subtypes: [...c.subtypes], supertypes: [...c.supertypes], printed: [...(o.faceDown ? c.types : (face?.types ?? c.types))] };
}

/** A spell as it was cast (CR 601.2): its characteristics on the stack, its mana value there, how it was cast. */
function asCast(g: GameState, e: Extract<GameEvent, { type: 'cast' }>): { was: Was; spell?: SpellWas } {
  const o = g.objects[e.object];
  // (Recorded with the spell already gone: only that a spell was cast, and by whom.)
  if (!o) return { was: { id: e.object, controller: e.player, token: false, types: [], subtypes: [], supertypes: [], printed: [] } };
  const c = chars(g, o);
  return {
    was: asItIs(g, o, c, e.player),
    spell: {
      name: c.name,
      colors: [...c.colors],
      power: c.power,
      toughness: c.toughness,
      hasPT: c.hasPT,
      keywords: c.keywords.map((k) => ({ id: k.id, ...(k.text !== undefined ? { text: k.text } : {}) })),
      mv: manaValueOf(g, o),
      ...(o.cast?.from ? { from: o.cast.from } : {}),
      ...(o.cast?.paid?.includes('warp') ? { warped: true as const } : {}),
      ...(o.faceDown ? {} : { object: structuredClone(o) }),
    },
  };
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

// The history by kind of event: read many times between one action and the next, so sorted once for each list.
const BY_TYPE = new WeakMap<Happening[], { n: number; by: Map<GameEvent['type'], Happening[]> }>();
function sorted(list: Happening[]): Map<GameEvent['type'], Happening[]> {
  let ix = BY_TYPE.get(list);
  if (!ix || ix.n !== list.length) {
    ix = { n: list.length, by: new Map() };
    for (const h of list) {
      const of = ix.by.get(h.e.type);
      if (of) of.push(h);
      else ix.by.set(h.e.type, [h]);
    }
    BY_TYPE.set(list, ix);
  }
  return ix.by;
}
/** The events of one type this turn (or the last), in order — with those of the resolution under way (`fresh`). */
function ofType<T extends GameEvent['type']>(g: GameState, type: T, lastTurn: boolean, fresh: GameEvent[] = []): (Happening & { e: Extract<GameEvent, { type: T }> })[] {
  const kept = sorted((lastTurn ? g.lastHistory : g.history) ?? []).get(type) ?? [];
  const more = lastTurn ? [] : entries(g, fresh.filter((e) => e.type === type));
  return (more.length ? [...kept, ...more] : kept) as (Happening & { e: Extract<GameEvent, { type: T }> })[];
}
const moves = (g: GameState, lastTurn: boolean, fresh?: GameEvent[]): Moved[] => ofType(g, 'moved', lastTurn, fresh).filter((h): h is Moved => Boolean(h.was));
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
      return ofType(g, 'sacrificed', lastTurn, fresh).filter((h): h is typeof h & About => Boolean(h.was));
    case 'created':
      return ofType(g, 'created', lastTurn, fresh).filter((h): h is typeof h & About => Boolean(h.was));
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

// ---------------------------------------------------------------------------
// Spells cast.
// ---------------------------------------------------------------------------

/** A spell cast this turn, as it was cast. */
export interface CastSpell {
  /** The cast itself: which of the turn's casts this is. */
  event: GameEvent;
  player: PlayerId;
  id: ObjectId;
  /** (Unknown for a spell that had ceased to be an object before the cast was recorded.) */
  zcc?: number;
  from?: ZoneName;
  mv: number;
  warped: boolean;
  /** The mana spent to cast it (CR 700.14). */
  spent: number;
  was: Was;
  spell?: SpellWas;
}

/** The spells cast this turn (or the last), in the order they were cast (CR 702.40a: storm counts those before it). */
export const casts = (g: GameState, lastTurn = false, fresh?: GameEvent[]): CastSpell[] =>
  ofType(g, 'cast', lastTurn, fresh).map((h) => {
    const w = h.was!;
    const s = h.spell;
    return { event: h.e, player: h.e.player, id: h.e.object, ...(w.zcc !== undefined ? { zcc: w.zcc } : {}), ...(s?.from ? { from: s.from } : {}), mv: s?.mv ?? 0, warped: Boolean(s?.warped), spent: h.e.manaSpent ?? 0, was: w, ...(s ? { spell: s } : {}) };
  });

const AS_CAST = new WeakMap<SpellWas, Characteristics>();
/** A cast spell's characteristics, in the shape a filter is matched against. */
function asCastChars(w: Was, s: SpellWas): Characteristics {
  let c = AS_CAST.get(s);
  if (!c) {
    c = { name: s.name, types: w.types, subtypes: w.subtypes, supertypes: w.supertypes, colors: s.colors as Color[], keywords: s.keywords as KeywordInstance[], power: s.power, toughness: s.toughness, rules: new Set(), combat: [], hasPT: s.hasPT };
    AS_CAST.set(s, c);
  }
  return c;
}

const COMPARE: Record<string, (v: number, n: number) => boolean> = { le: (v, n) => v <= n, ge: (v, n) => v >= n, eq: (v, n) => v === n, lt: (v, n) => v < n, gt: (v, n) => v > n };

/**
 * Whether a spell cast this turn matches a filter — "a blue spell", "a noncreature spell", "a spell with mana value 4
 * or greater" — as it was cast: its characteristics on the stack and its mana value with X as chosen, whatever has
 * become of the card since. (A split card in a graveyard is both its halves, an Adventure in exile a creature card, a
 * copy that was cast has ceased to exist: the spell cast was none of those.)
 */
export function castMatches(g: GameState, c: CastSpell, filter: ObjectFilter | undefined, ctx: FilterContext): boolean {
  if (!filter || !Object.keys(filter).length) return true;
  const s = c.spell;
  // A face-down spell is matched as what it showed; anything else a filter asks is asked of the object it is now.
  const o = s?.object ?? g.objects[c.id];
  if (!s || !o || !g.cards[(o.copyOf ?? o).card]) return false;
  const { manaValue: mv, ...rest } = filter;
  const fixed = mv && typeof mv.n === 'number' ? mv : undefined;
  if (fixed && !COMPARE[fixed.op]?.(s.mv, fixed.n as number)) return false;
  return matchesFilter(g, o, fixed ? rest : filter, { ...ctx, anyZone: true, lastController: c.player }, asCastChars(c.was, s));
}

/**
 * Which of the turn's casts an object is, as an index into them (or -1): the spell itself, or the permanent that spell
 * became — so "another spell" and "each spell cast before it" leave out that cast and no other, even of the same card
 * (CR 400.7: cast again, it's another spell). A card anywhere else isn't a spell: none of them is its own.
 *
 * `asZcc`: which object the question comes from, when that isn't the object as it now is — a triggered ability whose
 * source has left since (a storm spell countered in response; a creature gone before its enters ability resolves).
 */
export function ownCast(list: CastSpell[], o: GameObject, asZcc: number = o.zcc): number {
  // That object, or the spell it had just been; else the spell on the stack; else the spell this permanent was cast as.
  const zccs = asZcc !== o.zcc ? [asZcc, asZcc - 1] : o.zone === 'stack' ? [asZcc] : o.zone === 'battlefield' && o.cast ? [asZcc - 1] : [];
  if (!zccs.length) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    if (c.id === o.id && (c.zcc === undefined || zccs.includes(c.zcc))) return i;
  }
  return -1;
}

/** Which of the turn's casts a spell was (or -1): the cast of that object, or failing that the last of that card. */
export function castOf(list: CastSpell[], ref: { id: ObjectId; zcc?: number }): number {
  let last = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    if (c.id !== ref.id) continue;
    if (ref.zcc === undefined || c.zcc === undefined || c.zcc === ref.zcc) return i;
    if (last < 0) last = i;
  }
  return last;
}

/** The casts but this object's own: "other spells you've cast this turn". */
export const otherCasts = (list: CastSpell[], o: GameObject | null | undefined, asZcc?: number): CastSpell[] => {
  const own = o ? ownCast(list, o, asZcc ?? o.zcc) : -1;
  return own < 0 ? list : list.filter((_, i) => i !== own);
};

// ---------------------------------------------------------------------------
// Life.
// ---------------------------------------------------------------------------

/** How much life a player gained (`sign` 1) or lost (-1) this turn (or the last). */
export const lifeChange = (g: GameState, player: PlayerId, sign: 1 | -1, lastTurn = false, fresh?: GameEvent[]): number =>
  ofType(g, 'life', lastTurn, fresh).reduce((n, h) => n + (h.e.player === player && Math.sign(h.e.delta) === sign ? Math.abs(h.e.delta) : 0), 0);

/** The players who gained (`sign` 1) or lost (-1) life this turn (or the last). */
export const lifeChanged = (g: GameState, sign: 1 | -1, lastTurn = false, fresh?: GameEvent[]): PlayerId[] => [
  ...new Set(ofType(g, 'life', lastTurn, fresh).flatMap((h) => (Math.sign(h.e.delta) === sign ? [h.e.player] : []))),
];
