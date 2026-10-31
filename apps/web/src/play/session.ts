import type { CardDB, CardDef } from '@mtg/schema';
import { apply, createGame, legalActions, type Action, type GameEvent, type GameState, type PlayerId, type Step } from '@mtg/engine';
import type { Deck } from '../deck/model';

/**
 * A same-screen game: the engine state, every action applied (so a saved game is replayed rather than stored), and
 * each seat's auto-pass settings. Nothing here touches the DOM.
 */

export interface Seat {
  id: PlayerId;
  name: string;
  deckName: string;
  commanders: string[];
  /** Card names, one per card (commanders included). */
  cards: string[];
}

export interface GameSetup {
  seats: Seat[];
  seed: number;
  firstPlayer?: PlayerId;
}

/** When a seat's priority is passed for them (CR 117.3d: passing is still a choice they made in advance). */
export interface Stops {
  /** Steps of their own turn where they stop with an empty stack. */
  mine: Step[];
  /** Steps of other players' turns where they stop with an empty stack. */
  theirs: Step[];
  /** With something on the stack: pass if they have nothing to cast or activate (mana abilities don't count). */
  skipIfNothing: boolean;
  /** Keep priority after casting or activating (otherwise it passes, so opponents can respond). */
  hold: boolean;
}

export const DEFAULT_STOPS: Stops = { mine: ['main1', 'main2'], theirs: [], skipIfNothing: true, hold: false };

export interface Applied {
  state: GameState;
  /** Each action applied, the player's own first, then any passes made for seats — with its events. */
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

/** Something worth stopping for: anything but passing or making mana. */
const meaningful = (a: Action) => a.type !== 'pass' && a.type !== 'activate_mana';

/** Whether to pass priority for this seat without asking. */
export function shouldAutoPass(g: GameState, p: PlayerId, stops: Stops, passUntil: { player: PlayerId; turn: number } | null): boolean {
  if (g.over || g.pending || g.priority !== p) return false;
  const top = g.stack[g.stack.length - 1];
  // "End turn": keep passing this turn, unless an opponent puts something on the stack.
  if (passUntil && passUntil.player === p && passUntil.turn === g.turn && (!top || top.controller === p)) return true;
  if (!top) return !(g.active === p ? stops.mine : stops.theirs).includes(g.step);
  // Their own spell or ability on top: let the others respond to it.
  if (top.controller === p && !stops.hold) return true;
  return stops.skipIfNothing && !legalActions(g, p).some(meaningful);
}

/**
 * Applies a player's action, then passes for seats that wouldn't stop here. An action the engine refuses comes back
 * as an error with the state unchanged.
 */
export function step(
  g: GameState,
  action: Action,
  stops: Record<PlayerId, Stops>,
  passUntil: { player: PlayerId; turn: number } | null,
): { ok: true; applied: Applied } | { ok: false; error: string } {
  const r = apply(g, action);
  if (!r.ok) return { ok: false, error: r.error };
  const out: Applied = { state: r.state, steps: [{ action, before: g, after: r.state, events: r.events }] };
  for (let i = 0; i < 600; i++) {
    const s = out.state;
    const p = s.priority;
    // "End turn" lasts only for the turn it was asked in.
    const until = passUntil && passUntil.turn === s.turn ? passUntil : null;
    if (!p || !shouldAutoPass(s, p, stops[p] ?? DEFAULT_STOPS, until)) break;
    const pass: Action = { type: 'pass', player: p };
    const next = apply(s, pass);
    if (!next.ok) break;
    out.steps.push({ action: pass, before: s, after: next.state, events: next.events });
    out.state = next.state;
  }
  return { ok: true, applied: out };
}

// ---------------------------------------------------------------------------
// Saving: the setup and the actions; loading replays them (the engine is deterministic).
// ---------------------------------------------------------------------------

const SAVE_KEY = 'mtg-game-v1';

export interface SavedGame {
  setup: GameSetup;
  actions: Action[];
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
  saved: SavedGame,
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
