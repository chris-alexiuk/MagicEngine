import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { legalActions } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * When an ability applies is a condition, whatever kind of ability it is: a trigger's "during an opponent's turn" is part
 * of its event (`while`), a replacement effect's "while you have 5 or less life" is the static ability's `condition`.
 * No flag of its own for either, and none read by the code for one kind of event.
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  card('Sip', 'Instant', 'You gain 2 life.'),
  card('Insight', 'Instant', 'Draw a card.'),
  card('Sting', 'Instant', 'Target player loses 2 life.'),
  card('Phial', 'Legendary Artifact', 'If you would draw a card while you have no cards in hand, draw two cards instead.\nIf you would gain life while you have 5 or less life, you gain twice that much life instead.'),
  card('Chalice of Clerics', 'Artifact', 'If you would gain life while you control a Cleric, you gain twice that much life instead.'),
  card('Acolyte', 'Creature — Cleric', '', { power: '1', toughness: '1' }),
  card('Bloodletter', 'Creature — Vampire Demon', 'If an opponent would lose life during your turn, they lose twice that much life instead.', { power: '2', toughness: '4' }),
  card('Harrower', 'Creature — Demon', 'Whenever an opponent loses life for the first time during each of their turns, put a +1/+1 counter on this creature.', { power: '4', toughness: '4' }),
  card('Cutthroat', 'Creature — Merfolk Pirate', "Whenever you cast a spell during an opponent's turn, put a +1/+1 counter on this creature.", { power: '2', toughness: '1' }),
  card('Heckler', 'Creature — Faerie', 'Whenever an opponent casts a spell during their turn, you gain 1 life.', { power: '1', toughness: '1' }),
  card('Old Six', 'Legendary Creature — Treefolk', 'During your turn, nonland permanent cards in your graveyard have retrace.', { power: '2', toughness: '4' }),
  card('Crown', 'Artifact', '{1}, {T}: Tap target creature. This ability costs {1} less to activate during your turn.'),
];
const on = (player: PlayerId): GameState => toStep(start({ extra: CARDS }), 'main1', player);
/** Everyone passes until the stack is empty: the spell resolves, and whatever it triggered. */
const settle = (g: GameState): GameState => {
  for (let i = 0; i < 20 && g.stack.length && !g.pending; i++) g = passRound(g);
  return g;
};
const cast = (g: GameState, player: PlayerId, name: string, target?: PlayerId): GameState =>
  settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), autoTap: true, ...(target ? { targets: [[{ kind: 'player' as const, player: target }]] } : {}) }));
const counters = (g: GameState, id: string): number => g.objects[id]!.counters['+1/+1'] ?? 0;
/** Puts a player's hand on the bottom of their library. */
const emptyHand = (g: GameState, player: PlayerId): void => {
  for (const id of g.zones.hand[player]!.splice(0)) {
    g.objects[id]!.zone = 'library';
    g.zones.library[player]!.push(id);
  }
};

describe('a replacement effect that applies only "while …" or "during your turn"', () => {
  it('Phial of Galadriel: life gained is doubled at 5 life or less, and not above', () => {
    let g = on('alice');
    give(g, 'alice', 'Phial', 'battlefield');
    g.players.alice!.life = 5;
    g = cast(g, 'alice', 'Sip');
    expect(g.players.alice!.life).toBe(9);
    g = cast(g, 'alice', 'Sip');
    expect(g.players.alice!.life).toBe(11);
    // The opponent's life total is none of its business.
    g.players.bob!.life = 3;
    g = toStep(g, 'main1', 'bob');
    g = cast(g, 'bob', 'Sip');
    expect(g.players.bob!.life).toBe(5);
  });

  it('Phial of Galadriel: a draw with no cards in hand is two cards; with a card in hand, one', () => {
    let g = on('alice');
    give(g, 'alice', 'Phial', 'battlefield');
    emptyHand(g, 'alice');
    // The spell is on the stack as it resolves: the hand is empty.
    g = cast(g, 'alice', 'Insight');
    expect(g.zones.hand.alice!.length).toBe(2);
    g = cast(g, 'alice', 'Insight');
    expect(g.zones.hand.alice!.length).toBe(3);
  });

  it('any condition will do: "while you control a Cleric"', () => {
    let g = on('alice');
    give(g, 'alice', 'Chalice of Clerics', 'battlefield');
    g = cast(g, 'alice', 'Sip');
    expect(g.players.alice!.life).toBe(22);
    give(g, 'alice', 'Acolyte', 'battlefield');
    g = cast(g, 'alice', 'Sip');
    expect(g.players.alice!.life).toBe(26);
  });

  it('Bloodletter of Aclazotz: an opponent loses twice the life during your turn, and the life they lose on their own', () => {
    let g = on('alice');
    give(g, 'alice', 'Bloodletter', 'battlefield');
    g = cast(g, 'alice', 'Sting', 'bob');
    expect(g.players.bob!.life).toBe(16);
    g = toStep(g, 'main1', 'bob');
    g = cast(g, 'bob', 'Sting', 'bob');
    expect(g.players.bob!.life).toBe(14);
  });
});

describe('a trigger "during an opponent\'s turn" or "during their turn"', () => {
  it('"Whenever you cast a spell during an opponent\'s turn": not on your own', () => {
    let g = on('alice');
    const pirate = give(g, 'alice', 'Cutthroat', 'battlefield');
    g = cast(g, 'alice', 'Sip');
    expect(counters(g, pirate)).toBe(0);
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    g = cast(g, 'alice', 'Sip');
    expect(counters(g, pirate)).toBe(1);
  });

  it('"… loses life for the first time during each of their turns": the turn of the player who lost it, once', () => {
    let g = on('alice');
    const demon = give(g, 'alice', 'Harrower', 'battlefield');
    // On Alice's turn Bob's loss is not "during their turn".
    g = cast(g, 'alice', 'Sting', 'bob');
    expect(counters(g, demon)).toBe(0);
    g = toStep(g, 'main1', 'bob');
    g = cast(g, 'bob', 'Sting', 'bob');
    expect(counters(g, demon)).toBe(1);
    g = cast(g, 'bob', 'Sting', 'bob');
    expect(counters(g, demon)).toBe(1);
  });

  it('"Whenever an opponent casts a spell during their turn": theirs, not yours', () => {
    let g = on('alice');
    give(g, 'alice', 'Heckler', 'battlefield');
    // Bob casts on Alice's turn: not his.
    g = act(g, { type: 'pass', player: 'alice' });
    g = cast(g, 'bob', 'Insight');
    expect(g.players.alice!.life).toBe(20);
    g = toStep(g, 'main1', 'bob');
    g = cast(g, 'bob', 'Insight');
    expect(g.players.alice!.life).toBe(21);
  });
});

describe('"during your turn" on other kinds of ability', () => {
  it('Six: cards in your graveyard have retrace during your turn only', () => {
    const retrace = (g: GameState, id: string) => legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === id);
    let g = on('alice');
    give(g, 'alice', 'Old Six', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    give(g, 'alice', 'Forest', 'hand');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Forest', 'battlefield');
    expect(retrace(g, bear)).toBe(true);
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    expect(retrace(g, bear)).toBe(false);
  });

  it('"This ability costs {1} less to activate during your turn"', () => {
    const tap = (g: GameState, crown: string, bear: string) => ({ type: 'activate' as const, player: 'alice', object: crown, ability: 0, targets: [[{ kind: 'object' as const, object: bear }]] });
    let g = on('alice');
    const crown = give(g, 'alice', 'Crown', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const offered = (game: GameState) => legalActions(game, 'alice').some((a) => a.type === 'activate' && a.object === crown);
    // No mana at all: free on Alice's turn.
    expect(offered(g)).toBe(true);
    g = settle(act(g, tap(g, crown, bear)));
    expect(g.objects[bear]!.tapped).toBe(true);
    // On Bob's turn it costs {1}: not without a land, and with one.
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    g.objects[crown]!.tapped = false;
    expect(offered(g)).toBe(false);
    give(g, 'alice', 'Forest', 'battlefield');
    expect(offered(g)).toBe(true);
  });
});
