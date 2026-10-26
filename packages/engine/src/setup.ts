import type { CardDef } from '@mtg/schema';
import { beginTurn } from './flow.js';
import { emptyPool } from './mana.js';
import { nextRandom, shuffleInPlace } from './rng.js';
import {
  RulesError,
  type ChoiceAnswer,
  type GameConfig,
  type GameEvent,
  type GameState,
  type ObjectId,
  type PlayerId,
} from './types.js';
import { createObject, drawCard, moveObject, nextPlayer, zoneList } from './zones.js';

export interface PlayerSetup {
  id: PlayerId;
  name: string;
  /** Card keys (into `cards`), one entry per physical card. */
  deck: string[];
}

export interface NewGameOptions {
  players: PlayerSetup[];
  cards: Record<string, CardDef>;
  format?: GameConfig['format'];
  seed: number;
  /** Who takes the first turn; chosen at random when omitted. */
  firstPlayer?: PlayerId;
}

export function defaultConfig(format: GameConfig['format'], playerCount: number, seed: number): GameConfig {
  return {
    format,
    // CR 103.4: starting life is 20; CR 903.7: 40 in Commander.
    startingLife: format === 'commander' ? 40 : 20,
    startingHandSize: 7,
    // CR 402.2: maximum hand size is normally seven.
    maxHandSize: 7,
    // CR 103.5c: in a multiplayer game the first mulligan is free.
    freeMulligan: playerCount > 2,
    seed,
  };
}

/** Sets up a game and starts the opening-hand (mulligan) process. */
export function createGame(opts: NewGameOptions): { state: GameState; events: GameEvent[] } {
  if (opts.players.length < 2) throw new RulesError('A game needs at least two players.');
  const ids = opts.players.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new RulesError('Player ids must be unique.');

  const config = defaultConfig(opts.format ?? 'constructed', opts.players.length, opts.seed);
  const used = new Set(opts.players.flatMap((p) => p.deck));
  const cards: Record<string, CardDef> = {};
  for (const key of used) {
    const def = opts.cards[key];
    if (!def) throw new RulesError(`Unknown card ${key}.`);
    cards[key] = def;
  }

  const g: GameState = {
    config,
    cards,
    players: {},
    order: ids,
    objects: {},
    zones: { library: {}, hand: {}, graveyard: {}, battlefield: [], exile: [], command: [] },
    stack: [],
    turn: 0,
    active: ids[0]!,
    firstPlayer: ids[0]!,
    step: 'untap',
    priority: null,
    passed: [],
    pending: null,
    started: false,
    opening: null,
    extraCleanup: false,
    winner: null,
    over: false,
    rng: opts.seed | 0,
    nextId: 1,
  };
  const events: GameEvent[] = [];

  for (const p of opts.players) {
    g.players[p.id] = {
      id: p.id,
      name: p.name,
      life: config.startingLife,
      poison: 0,
      pool: emptyPool(),
      landsPlayedThisTurn: 0,
      drewFromEmptyLibrary: false,
      lost: false,
      mulligans: 0,
      keptHand: false,
    };
    for (const zone of ['library', 'hand', 'graveyard'] as const) g.zones[zone][p.id] = [];
    // CR 108.3: the owner of a card is the player who started the game with it in their deck.
    for (const key of p.deck) createObject(g, key, p.id, 'library');
  }

  // CR 103.1: determine the starting player; turn order proceeds from them.
  const first = opts.firstPlayer ?? ids[Math.floor(nextRandom(g) * ids.length)]!;
  if (!ids.includes(first)) throw new RulesError(`Unknown first player ${first}.`);
  g.firstPlayer = first;
  g.active = first;
  events.push({ type: 'game_started', order: turnOrderFrom(g, first) });

  // CR 103.3: each player shuffles their deck, which becomes their library (CR 401.1).
  for (const p of ids) {
    shuffleInPlace(g, zoneList(g, 'library', p));
    events.push({ type: 'shuffled', player: p });
  }
  // CR 103.5: each player draws their starting hand.
  for (const p of ids) for (let i = 0; i < config.startingHandSize; i++) drawCard(g, p, events);

  g.opening = { undecided: turnOrderFrom(g, first), mulligans: [], bottoms: [] };
  promptOpening(g);
  return { state: g, events };
}

function turnOrderFrom(g: GameState, first: PlayerId): PlayerId[] {
  const out = [first];
  for (let p = nextPlayer(g, first); p !== first; p = nextPlayer(g, p)) out.push(p);
  return out;
}

/** Number of cards a player puts on the bottom after their latest mulligan. */
function bottomCount(g: GameState, player: PlayerId): number {
  const taken = g.players[player]!.mulligans;
  // CR 103.5c: the first mulligan in a multiplayer game doesn't count.
  return Math.max(0, taken - (g.config.freeMulligan ? 1 : 0));
}

function promptOpening(g: GameState): void {
  const o = g.opening!;
  if (o.bottoms.length) {
    const next = o.bottoms[0]!;
    g.pending = { kind: 'bottom_cards', player: next.player, count: next.count };
    return;
  }
  if (o.undecided.length) {
    g.pending = { kind: 'mulligan', player: o.undecided[0]! };
    return;
  }
  g.pending = null;
}

/**
 * CR 103.5: the London mulligan. In turn order, each undecided player declares
 * keep or mulligan; then everyone mulliganing shuffles, draws a new hand and puts
 * cards on the bottom; repeat until nobody mulligans.
 */
export function answerOpening(g: GameState, player: PlayerId, answer: ChoiceAnswer, events: GameEvent[]): void {
  const o = g.opening;
  if (!o) throw new RulesError('The opening-hand process is over.');

  if (answer.kind === 'mulligan') {
    if (answer.keep) {
      g.players[player]!.keptHand = true;
      events.push({ type: 'kept', player, bottomed: 0 });
    } else {
      // CR 103.5: a player can't mulligan once their opening hand would be zero cards.
      const next = Math.max(0, g.players[player]!.mulligans + 1 - (g.config.freeMulligan ? 1 : 0));
      if (next >= g.config.startingHandSize) {
        throw new RulesError('You can’t mulligan to zero cards.');
      }
      o.mulligans.push(player);
    }
    o.undecided.shift();
    if (o.undecided.length === 0 && o.mulligans.length) {
      for (const p of o.mulligans) {
        const hand = [...zoneList(g, 'hand', p)];
        for (const id of hand) moveObject(g, id, 'library', events);
        shuffleInPlace(g, zoneList(g, 'library', p));
        events.push({ type: 'shuffled', player: p });
        for (let i = 0; i < g.config.startingHandSize; i++) drawCard(g, p, events);
        g.players[p]!.mulligans++;
        events.push({ type: 'mulligan', player: p, count: g.players[p]!.mulligans });
        const count = bottomCount(g, p);
        if (count > 0) o.bottoms.push({ player: p, count });
      }
    }
  } else if (answer.kind === 'bottom_cards') {
    const job = o.bottoms[0];
    if (!job || job.player !== player) throw new RulesError('You have no cards to put on the bottom.');
    const hand = zoneList(g, 'hand', player);
    const ids: ObjectId[] = answer.objects;
    if (ids.length !== job.count || new Set(ids).size !== ids.length || !ids.every((id) => hand.includes(id))) {
      throw new RulesError(`Choose exactly ${job.count} card(s) from your hand.`);
    }
    // CR 103.5: put that many cards on the bottom of the library in any order.
    for (const id of ids) moveObject(g, id, 'library', events, { position: 'bottom' });
    o.bottoms.shift();
  } else {
    throw new RulesError('Unexpected answer during the opening hand.');
  }

  // A round ends once everyone has declared and all bottoming is done; mulliganing players go again.
  if (o.undecided.length === 0 && o.bottoms.length === 0 && o.mulligans.length) {
    o.undecided = [...o.mulligans];
    o.mulligans = [];
  }
  promptOpening(g);
  if (!g.pending) {
    g.opening = null;
    g.started = true;
    beginTurn(g, g.firstPlayer, events);
  }
}
