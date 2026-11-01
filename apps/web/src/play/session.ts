import type { CardDB, CardDef } from '@mtg/schema';
import { apply, createGame, legalActions, type Action, type GameEvent, type GameState, type PlayerId, type StackEntry, type Step } from '@mtg/engine';
import type { Deck } from '../deck/model';
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
  /** Pass anyway when the only things they could do are mana abilities (at a stop, or with something on the stack). */
  skipIfNothing: boolean;
  /** Keep priority after casting or activating (otherwise it passes, so opponents can respond). */
  hold: boolean;
}

/** Like a digital client: your main phases, combat when you attack or are attacked, and anything you could answer. */
export const DEFAULT_STOPS: Stops = { mine: ['main1', 'main2'], theirs: [], skipIfNothing: true, hold: false };

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

export function seatFromDeck(id: PlayerId, name: string, deck: Deck): Seat {
  return {
    id,
    name,
    deckName: deck.name,
    commanders: [...deck.commanders],
    cards: [...deck.commanders, ...deck.main.flatMap((c) => Array.from({ length: c.count }, () => c.name))],
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

export type PassUntil = { player: PlayerId; turn: number } | null;

/** Whether to pass priority for this seat without asking. */
export function shouldAutoPass(g: GameState, p: PlayerId, stops: Stops, passUntil: PassUntil, dummy = false): boolean {
  if (g.over || g.pending || g.priority !== p) return false;
  if (dummy) return true;
  const top = g.stack[g.stack.length - 1];
  // "Pass until end of turn": keep passing this turn, unless something targets this player or what they control.
  if (passUntil && passUntil.player === p && passUntil.turn === g.turn && (!top || top.controller === p || !touches(g, top, p))) return true;
  const nothing = () => stops.skipIfNothing && !legalActions(g, p).some(meaningful);
  if (!top) return !(g.active === p ? stops.mine : stops.theirs).includes(g.step) || nothing();
  // Their own spell or ability on top: let the others respond to it.
  if (top.controller === p && !stops.hold) return true;
  return nothing();
}

export interface Ctx {
  stops: Record<PlayerId, Stops>;
  passUntil: PassUntil;
  dummies: ReadonlySet<PlayerId>;
}

/** Passes for seats that wouldn't stop here, and answers the dummy's choices, until someone has to decide. */
export function advance(g: GameState, ctx: Ctx, out: Applied = { state: g, steps: [] }): Applied {
  for (let i = 0; i < 1200; i++) {
    const s = out.state;
    if (s.over) break;
    let action: Action | null = null;
    if (s.pending) {
      if (!ctx.dummies.has(s.pending.player)) break;
      const a = dummyAnswer(s);
      if (!a) break;
      action = { type: 'choose', player: a.player, answer: a.answer };
    } else {
      const p = s.priority;
      // "End turn" lasts only for the turn it was asked in.
      const until = ctx.passUntil && ctx.passUntil.turn === s.turn ? ctx.passUntil : null;
      if (!p || !shouldAutoPass(s, p, ctx.stops[p] ?? DEFAULT_STOPS, until, ctx.dummies.has(p))) break;
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
  let s = g;
  for (let i = 0; i < 40; i++) {
    const p = i === 0 ? me : s.priority;
    if (i > 0) {
      if (s.over || s.turn !== g.turn) return { kind: 'end' };
      if (s.pending) return ctx.dummies.has(s.pending.player) ? { kind: 'other' } : s.pending.player === me ? { kind: 'step', step: s.step } : { kind: 'other' };
      if (!p) return { kind: 'other' };
      const until = ctx.passUntil && ctx.passUntil.turn === s.turn ? ctx.passUntil : null;
      if (!shouldAutoPass(s, p, ctx.stops[p] ?? DEFAULT_STOPS, until, ctx.dummies.has(p))) return p === me ? { kind: 'step', step: s.step } : { kind: 'other' };
    }
    const r = apply(s, { type: 'pass', player: p! });
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
