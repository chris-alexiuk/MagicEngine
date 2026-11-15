import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * Where a card goes instead of the graveyard, with what counters, and what else happens (schema ExileInsteadNode: `to`,
 * `counters`, `then`). What else happens is a list of effects the engine runs as the card is exiled — no card's rider
 * is known to the mover. (Kalitas, Dauthi Voidwalker and the choices between such effects: instead.test.ts.)
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  card('Murder', 'Instant', 'Destroy target creature.'),
  card('Crystal', 'Legendary Artifact', 'If a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.'),
  card('Scholar of Endings', 'Enchantment', 'If a creature an opponent controls would die, instead exile it and you draw a card.'),
  card('Martyr', 'Creature — Spirit', 'If this creature would die, instead exile it and you gain 3 life.', { power: '1', toughness: '1' }),
  card('Burrower', 'Creature — Zombie', "If this creature would die, put it on top of its owner's library instead.", { power: '3', toughness: '2' }),
  card('Sleeper', 'Creature — Elf', "If this creature would die, put it on the bottom of its owner's library instead.", { power: '2', toughness: '3' }),
  card('Voidwalker', 'Creature — Dauthi', "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.", { power: '3', toughness: '2' }),
];
const board = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const settle = (g: GameState): GameState => {
  for (let i = 0; i < 20 && g.stack.length && !g.pending; i++) g = passRound(g);
  return g;
};
const murder = (g: GameState, player: PlayerId, target: string): GameState =>
  settle(act(g, { type: 'cast', player, object: give(g, player, 'Murder', 'hand'), targets: [[{ kind: 'object', object: target }]] }));

describe('"instead exile it and …": what else happens is a list of effects', () => {
  it('"… and you gain 2 life": the ability\'s controller gains it as the creature is exiled', () => {
    let g = board();
    give(g, 'alice', 'Crystal', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = murder(g, 'alice', bear);
    expect(g.objects[bear]!.zone).toBe('exile');
    expect(g.players.alice!.life).toBe(22);
    // Her own creature dies as usual.
    g = murder(g, 'alice', mine);
    expect(g.objects[mine]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(22);
  });

  it('"… and you draw a card": an effect no card needed a flag for', () => {
    let g = board();
    give(g, 'alice', 'Scholar of Endings', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = murder(g, 'alice', bear);
    expect(g.objects[bear]!.zone).toBe('exile');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('a creature\'s own "If this creature would die, instead exile it and you gain 3 life"', () => {
    let g = board();
    const martyr = give(g, 'alice', 'Martyr', 'battlefield');
    g = murder(g, 'alice', martyr);
    expect(g.objects[martyr]!.zone).toBe('exile');
    expect(g.players.alice!.life).toBe(23);
  });
});

describe('where it goes, and with what', () => {
  it("on top of its owner's library, or on the bottom", () => {
    let g = board();
    const top = give(g, 'alice', 'Burrower', 'battlefield');
    const bottom = give(g, 'alice', 'Sleeper', 'battlefield');
    g = murder(g, 'alice', top);
    g = murder(g, 'alice', bottom);
    const library = g.zones.library.alice!;
    expect(g.objects[top]!.zone).toBe('library');
    expect(g.objects[bottom]!.zone).toBe('library');
    // One of them is the next card drawn; the other is the last.
    const ends = [library[0], library[library.length - 1]];
    expect(ends).toContain(top);
    expect(ends).toContain(bottom);
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.objects[top]!.zone).toBe('hand');
  });

  it('exiled with a void counter on it', () => {
    let g = board();
    give(g, 'alice', 'Voidwalker', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = murder(g, 'alice', bear);
    expect(g.objects[bear]!.zone).toBe('exile');
    expect(g.objects[bear]!.counters.void).toBe(1);
  });
});
