import { readFileSync } from 'node:fs';
import { compileCard, compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { apply, createGame, type Action, type GameEvent, type GameState, type PlayerId, type Step, type ZoneName } from '../src/index.js';
import { createObject } from '../src/zones.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8'),
) as ScryfallCard[];

/** Fixture cards keyed by name (the engine treats card keys as opaque). */
export const CARDS: Record<string, CardDef> = Object.fromEntries(
  compileCards(fixture).db.cards.map((c) => [c.name, c]),
);

/** Builds a one-off card from Scryfall-style fields, for rules scenarios the fixture doesn't cover. */
export function makeCard(fields: Partial<ScryfallCard> & { name: string; type_line: string }): CardDef {
  const card: ScryfallCard = {
    object: 'card',
    id: `test-${fields.name}`,
    oracle_id: `test-${fields.name}`,
    layout: 'normal',
    set: 'tst',
    rarity: 'common',
    oracle_text: '',
    mana_cost: '',
    ...fields,
  };
  return compileCard(card, card.oracle_id!);
}

export const PLAYERS = ['alice', 'bob', 'carol', 'dave'];

export interface StartOptions {
  players?: number;
  format?: 'commander' | 'constructed';
  seed?: number;
  /** Extra card definitions available to decks and give(). */
  extra?: CardDef[];
  /** Deck contents per player; defaults to 40 Forests. */
  decks?: Record<PlayerId, string[]>;
  /** Stop at the mulligan decision instead of keeping every hand. */
  mulligan?: boolean;
  /** Commander card keys per player (Commander games). */
  commanders?: Record<PlayerId, string[]>;
}

export function start(opts: StartOptions = {}): GameState {
  const count = opts.players ?? 2;
  const ids = PLAYERS.slice(0, count);
  const cards = { ...CARDS };
  for (const c of opts.extra ?? []) cards[c.name] = c;
  // Every card a test might give() has to be in the game's card table, so pad decks with one copy each.
  // (Dungeon cards start outside the game, CR 309.2.)
  const extras = (opts.extra ?? []).filter((c) => !c.faces[0]!.types.includes('Dungeon')).map((c) => c.name);
  const { state } = createGame({
    players: ids.map((id) => ({
      id,
      name: id[0]!.toUpperCase() + id.slice(1),
      deck: opts.decks?.[id] ?? [...Array.from({ length: 40 }, () => 'Forest'), ...extras],
      ...(opts.commanders?.[id] ? { commanders: opts.commanders[id] } : {}),
    })),
    cards,
    format: opts.format ?? 'constructed',
    seed: opts.seed ?? 42,
    firstPlayer: 'alice',
  });
  if (opts.mulligan) return state;
  let g = state;
  while (g.pending?.kind === 'mulligan') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } });
  // A card a test added may be one that can begin the game on the battlefield (CR 103.6a): it stays in the hand.
  while (g.pending?.kind === 'opening_battlefield') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'opening_battlefield', objects: [] } });
  return g;
}

/** Applies an action and fails the test with the engine's message if it's illegal. */
export function act(g: GameState, action: Action): GameState {
  const r = apply(g, action);
  if (!r.ok) throw new Error(`illegal ${action.type}: ${r.error}`);
  return r.state;
}

export function actWithEvents(g: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const r = apply(g, action);
  if (!r.ok) throw new Error(`illegal ${action.type}: ${r.error}`);
  return { state: r.state, events: r.events };
}

/** The error an illegal action produces. */
export function illegal(g: GameState, action: Action): string {
  const r = apply(g, action);
  if (r.ok) throw new Error(`expected ${action.type} to be illegal`);
  return r.error;
}

/** Everyone passes until the game reaches `step` (optionally on `player`'s turn). */
export function toStep(g: GameState, step: Step, player?: PlayerId): GameState {
  for (let i = 0; i < 500; i++) {
    if (g.step === step && (!player || g.active === player) && g.priority !== null) return g;
    // Discarding down to hand size is routine on the way through other players' turns.
    if (g.pending?.kind === 'discard_to_hand_size') {
      const p = g.pending;
      g = act(g, { type: 'choose', player: p.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[p.player]!.slice(0, p.count) } });
      continue;
    }
    // So is skipping combat: no attackers, no blockers.
    if (g.pending?.kind === 'declare_attackers') {
      g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
      continue;
    }
    if (g.pending?.kind === 'dredge') {
      g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'dredge', object: null } });
      continue;
    }
    if (g.pending?.kind === 'keep_tapped') {
      g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'keep_tapped', objects: [] } });
      continue;
    }
    if (g.pending?.kind === 'declare_blockers') {
      g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      continue;
    }
    if (g.pending) throw new Error(`stopped by pending ${g.pending.kind} for ${g.pending.player}`);
    if (!g.priority) throw new Error(`no one has priority in ${g.step}`);
    g = act(g, { type: 'pass', player: g.priority });
  }
  throw new Error(`never reached ${step}`);
}

/** Test-only setup: puts a new card object straight into a zone, bypassing the rules. */
export function give(g: GameState, player: PlayerId, name: string, zone: Exclude<ZoneName, 'stack'>, opts: { sick?: boolean } = {}): string {
  if (!g.cards[name]) g.cards[name] = CARDS[name] ?? (() => { throw new Error(`unknown card ${name}`); })();
  const o = createObject(g, name, player, zone);
  if (zone === 'battlefield') o.sick = opts.sick ?? false;
  return o.id;
}

/** Every player still in the game passes once, starting with whoever has priority. */
export function passRound(g: GameState): GameState {
  const count = g.order.filter((p) => !g.players[p]!.lost).length;
  for (let i = 0; i < count; i++) {
    if (!g.priority || g.pending) break;
    g = act(g, { type: 'pass', player: g.priority });
  }
  return g;
}

export function names(g: GameState, ids: string[]): string[] {
  return ids.map((id) => g.cards[g.objects[id]!.card]!.name);
}
