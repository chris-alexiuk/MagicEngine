import type { CardDB, CardDef } from '@mtg/schema';
import { apply, createGame, legalActions, type Action, type GameEvent, type GameState, type PlayerId, type StackEntry, type Step } from '@mtg/engine';
import { deckPrintings, type Deck } from '../deck/model';
import type { Printing } from '../skins';
import { dummyAnswer } from './dummy';

/**
 * A game on one screen: the engine state, every action applied (so a saved game is replayed rather than stored), and
 * each seat's auto-pass settings. Nothing here touches the DOM.
 */

/**
 * - solo: you against a practice dummy that never acts (a playtest).
 * - open: one person plays every seat with every hand face up; the screen follows whoever decides.
 * - hotseat: players pass the device, and each sees only their own hand.
 */
export type Mode = 'solo' | 'open' | 'hotseat';

export interface Seat {
  id: PlayerId;
  name: string;
  deckName: string;
  commanders: string[];
  /** Card names, one per card (commanders included). */
  cards: string[];
  /** The practice dummy: it never acts, and its choices are answered for it. */
  dummy?: boolean;
  /** Printings the deck asked for by another name, by card name: what those cards are drawn with. */
  skins?: Record<string, Printing>;
}

export interface GameSetup {
  seats: Seat[];
  seed: number;
  firstPlayer?: PlayerId;
  /** Missing in games saved before modes existed: those were hotseat games. */
  mode?: Mode;
}

export const modeOf = (s: GameSetup): Mode => s.mode ?? 'hotseat';
export const dummiesOf = (s: GameSetup): Set<PlayerId> => new Set(s.seats.filter((x) => x.dummy).map((x) => x.id));
/** Undo replays the game without its last decision, so it's offered only where nothing hidden is learned by it. */
export const canUndoIn = (m: Mode) => m !== 'hotseat';

/** When a seat's priority is passed for them (CR 117.3d: passing is still a choice they made in advance). */
export interface Stops {
  /** Steps of their own turn where they stop with an empty stack. */
  mine: Step[];
  /** Steps of other players' turns where they stop with an empty stack. */
  theirs: Step[];
  /**
   * At a stop, pass anyway when the only things they could do there are mana abilities. Off unless the seat asks for
   * it: a turn doesn't go by on its own, whatever its player holds.
   */
  skipIfNothing: boolean;
  /**
   * Hold priority: with their own spell or ability on top of the stack they are always asked, so they can respond to
   * it themselves before anyone else does (CR 117.3c: a player who casts a spell or activates an ability has priority
   * again afterwards). Otherwise priority is passed for them there, so that it resolves.
   */
  hold: boolean;
}

/**
 * Your main phases — whether or not there's anything you could do in them — combat when you attack or are attacked,
 * and anything you could answer.
 */
export const DEFAULT_STOPS: Stops = { mine: ['main1', 'main2'], theirs: [], skipIfNothing: false, hold: false };

/**
 * A solo playtest goes through the dummy's turn as well: you're asked as it begins and at its end step (where "at the
 * end of your turn, I…" happens), so that turn is never passed over unseen either.
 */
export const SOLO_STOPS: Stops = { ...DEFAULT_STOPS, theirs: ['upkeep', 'end'] };

/** A seat's stops before its player changes them. */
export const defaultStops = (m: Mode): Stops => (m === 'solo' ? SOLO_STOPS : DEFAULT_STOPS);

export interface Applied {
  state: GameState;
  /** Each action applied, the player's own first, then any passes and dummy answers made for seats — with its events. */
  steps: { action: Action; before: GameState; after: GameState; events: GameEvent[] }[];
}

/** Every card definition a game might use: the decks' cards plus dungeons (they start outside the game, CR 309.2). */
export function cardsFor(seats: Seat[], db: CardDB, lookup: (name: string) => CardDef | undefined): Record<string, CardDef> {
  const cards: Record<string, CardDef> = {};
  for (const c of [...db.cards, ...db.tokens]) if (c.faces[0]?.types.includes('Dungeon')) cards[c.name] = c;
  for (const s of seats) {
    for (const n of s.cards) {
      const def = lookup(n);
      if (!def) throw new Error(`${s.name}’s deck has a card the card DB doesn’t know: ${n}.`);
      cards[n] = def;
    }
  }
  return cards;
}

export function seatFromDeck(id: PlayerId, name: string, deck: Deck, lookup?: (name: string) => CardDef | undefined): Seat {
  const skins = lookup ? deckPrintings(deck, lookup) : {};
  return {
    id,
    name,
    deckName: deck.name,
    commanders: [...deck.commanders],
    cards: [...deck.commanders, ...deck.main.flatMap((c) => Array.from({ length: c.count }, () => c.name))],
    ...(Object.keys(skins).length ? { skins } : {}),
  };
}

/** The practice dummy: a library of basic lands it never plays. */
export function dummySeat(id: PlayerId, land: string): Seat {
  return { id, name: 'Practice dummy', deckName: `${land} ×100`, commanders: [], cards: Array.from({ length: 100 }, () => land), dummy: true };
}

export function newGame(setup: GameSetup, cards: Record<string, CardDef>): { state: GameState; events: GameEvent[] } {
  return createGame({
    players: setup.seats.map((s) => ({ id: s.id, name: s.name, deck: s.cards, ...(s.commanders.length ? { commanders: s.commanders } : {}) })),
    cards,
    format: 'commander',
    seed: setup.seed,
    ...(setup.firstPlayer ? { firstPlayer: setup.firstPlayer } : {}),
  });
}

/** Who has to decide next: the player a choice waits on, else the player with priority. */
export function decider(g: GameState): PlayerId | null {
  if (g.over) return null;
  return g.pending?.player ?? g.priority ?? null;
}

/** Something worth stopping for: anything but passing, making mana, or conceding. */
export const meaningful = (a: Action) => a.type !== 'pass' && a.type !== 'activate_mana' && a.type !== 'concede' && a.type !== 'manual';

/** Whether a stack entry targets this player or something they control. */
export function touches(g: GameState, e: StackEntry, p: PlayerId): boolean {
  return e.targets.flat().some((t) => (t.kind === 'player' ? t.player === p : t.kind === 'object' ? g.objects[t.id]?.controller === p : false));
}

/**
 * "Pass for me until…": the rest of a turn (no step), or until a step of that turn — the seat then stops there, even
 * where it usually wouldn't. Either way it stops early if something targets the player or what they control.
 */
export type PassUntil = { player: PlayerId; turn: number; step?: Step } | null;

/** The steps of a turn, in order. */
export const TURN_STEPS: readonly Step[] = ['untap', 'upkeep', 'draw', 'main1', 'beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat', 'main2', 'end', 'cleanup'];
const stepAt = (s: Step) => TURN_STEPS.indexOf(s);

/** Whether a "pass until" has been carried out (or the game has moved past it): it then no longer applies. */
export function passUntilDone(g: GameState, u: PassUntil): boolean {
  if (!u) return true;
  if (g.turn !== u.turn) return true;
  return u.step !== undefined && stepAt(g.step) >= stepAt(u.step);
}

/** Whether to pass priority for this seat without asking. */
export function shouldAutoPass(g: GameState, p: PlayerId, stops: Stops, passUntil: PassUntil, dummy = false): boolean {
  if (g.over || g.pending || g.priority !== p) return false;
  if (dummy) return true;
  const top = g.stack[g.stack.length - 1];
  if (passUntil && passUntil.player === p && passUntil.turn === g.turn) {
    const reached = passUntil.step !== undefined && stepAt(g.step) >= stepAt(passUntil.step);
    // Keep passing until then, unless something targets this player or what they control.
    if (!reached && (!top || top.controller === p || !touches(g, top, p))) return true;
    // The step asked for: stop here with an empty stack, whatever the usual stops are.
    if (reached && g.step === passUntil.step && !top) return false;
  }
  // Mana in the pool is something to do: the player made it for a reason, and passing would lose it.
  const floating = Object.values(g.players[p]?.pool ?? {}).some((n) => n > 0) || (g.players[p]?.restricted?.length ?? 0) > 0;
  const nothing = () => !floating && !legalActions(g, p).some(meaningful);
  if (!top) {
    if (!(g.active === p ? stops.mine : stops.theirs).includes(g.step)) return true;
    // One of the seat's stops: it's asked, whatever it could do there, unless it said to skip those.
    return stops.skipIfNothing && nothing();
  }
  // Their own spell or ability on top: the others get to respond to it and it resolves — unless they're holding
  // priority, and then they keep it until they pass it themselves, whatever they could or couldn't do with it.
  if (top.controller === p) return !stops.hold;
  // Someone else's: asked only when there's something they could do about it.
  return nothing();
}

export interface Ctx {
  stops: Record<PlayerId, Stops>;
  passUntil: PassUntil;
  dummies: ReadonlySet<PlayerId>;
  /**
   * A seat holding priority just for what it is putting on the stack now (Shift+click): as if its stops said to hold,
   * until it has been asked.
   */
  holding?: PlayerId | null;
}

/** A seat's stops for this pass over the game: its own, and holding priority if it asked to this once. */
export function stopsFor(ctx: Ctx, p: PlayerId): Stops {
  const s = ctx.stops[p] ?? DEFAULT_STOPS;
  return ctx.holding === p && !s.hold ? { ...s, hold: true } : s;
}

/** Passes for seats that wouldn't stop here, and answers the dummy's choices, until someone has to decide. */
export function advance(g: GameState, ctx: Ctx, out: Applied = { state: g, steps: [] }): Applied {
  for (let i = 0; i < 1200; i++) {
    const s = out.state;
    if (s.over) break;
    let action: Action | null = null;
    if (s.pending) {
      if (ctx.dummies.has(s.pending.player)) {
        const a = dummyAnswer(s);
        if (!a) break;
        action = { type: 'choose', player: a.player, answer: a.answer };
      } else if (s.pending.kind === 'declare_attackers' && ctx.passUntil?.player === s.pending.player && !passUntilDone(s, ctx.passUntil)) {
        // "End turn" (or "to the end step") from before combat: this seat attacks with nothing. If something has to
        // attack, the engine refuses that below and the seat is asked after all.
        action = { type: 'choose', player: s.pending.player, answer: { kind: 'declare_attackers', attacks: [] } };
      } else break;
    } else {
      const p = s.priority;
      // "End turn" lasts only for the turn it was asked in.
      const until = ctx.passUntil && ctx.passUntil.turn === s.turn ? ctx.passUntil : null;
      if (!p || !shouldAutoPass(s, p, stopsFor(ctx, p), until, ctx.dummies.has(p))) break;
      action = { type: 'pass', player: p };
    }
    const next = apply(s, action);
    if (!next.ok) break;
    out.steps.push({ action, before: s, after: next.state, events: next.events });
    out.state = next.state;
  }
  return out;
}

/**
 * Applies a player's action, then passes for seats that wouldn't stop here. An action the engine refuses comes back
 * as an error with the state unchanged.
 */
export function step(g: GameState, action: Action, ctx: Ctx): { ok: true; applied: Applied } | { ok: false; error: string } {
  const r = apply(g, action);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, applied: advance(r.state, ctx, { state: r.state, steps: [{ action, before: g, after: r.state, events: r.events }] }) };
}

/**
 * Where passing now would next stop for this player this turn, for the pass button's label: a step name, "end"
 * (the turn ends first), or "other" (someone else decides first).
 */
export function peekPass(g: GameState, me: PlayerId, ctx: Ctx): { kind: 'step'; step: Step } | { kind: 'end' } | { kind: 'other' } {
  const first = apply(g, { type: 'pass', player: me });
  if (!first.ok) return { kind: 'other' };
  let s = first.state;
  for (let i = 0; i < 60; i++) {
    if (s.over || s.turn !== g.turn) return { kind: 'end' };
    let action: Action;
    if (s.pending) {
      if (!ctx.dummies.has(s.pending.player)) return s.pending.player === me ? { kind: 'step', step: s.step } : { kind: 'other' };
      // The dummy's choices are answered for it (its discard at cleanup): they don't stop anyone.
      const a = dummyAnswer(s);
      if (!a) return { kind: 'other' };
      action = { type: 'choose', player: a.player, answer: a.answer };
    } else {
      const p = s.priority;
      if (!p) return { kind: 'other' };
      const until = ctx.passUntil && ctx.passUntil.turn === s.turn ? ctx.passUntil : null;
      if (!shouldAutoPass(s, p, stopsFor(ctx, p), until, ctx.dummies.has(p))) return p === me ? { kind: 'step', step: s.step } : { kind: 'other' };
      action = { type: 'pass', player: p };
    }
    const r = apply(s, action);
    if (!r.ok) return { kind: 'other' };
    s = r.state;
  }
  return { kind: 'other' };
}

// ---------------------------------------------------------------------------
// Saving: the setup and the actions; loading replays them (the engine is deterministic).
// ---------------------------------------------------------------------------

const SAVE_KEY = 'mtg-game-v1';

export interface SavedGame {
  setup: GameSetup;
  actions: Action[];
  /** Where each of the players' own decisions starts in `actions` (what undo goes back to). */
  marks?: number[];
  savedAt: string;
}

export function saveGame(s: SavedGame): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the game just isn't resumable */
  }
}

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedGame;
    return s && Array.isArray(s.actions) && s.setup && Array.isArray(s.setup.seats) ? s : null;
  } catch {
    return null;
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Replays a saved game; null if it no longer replays (the card DB or engine changed). `each` sees every action as it's
 * applied, for rebuilding the log.
 */
export function replay(
  saved: Pick<SavedGame, 'setup' | 'actions'>,
  cards: Record<string, CardDef>,
  each: (before: GameState, after: GameState, events: GameEvent[]) => void,
): GameState | null {
  try {
    const start = newGame(saved.setup, cards);
    let state = start.state;
    each(state, state, start.events);
    for (const a of saved.actions) {
      const r = apply(state, a);
      if (!r.ok) return null;
      each(state, r.state, r.events);
      state = r.state;
    }
    return state;
  } catch {
    return null;
  }
}
