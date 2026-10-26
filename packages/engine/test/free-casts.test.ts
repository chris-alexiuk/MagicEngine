import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, ...extra });

const CARDS = [
  card('Zap', 'Instant', 'Zap deals 2 damage to any target.', { mana_cost: '{R}', cmc: 1 }),
  card('Cascade Beast', 'Creature — Beast', 'Cascade', { mana_cost: '{3}{R}', cmc: 4, power: '4', toughness: '4' }),
  card('Rebound Draw', 'Sorcery', 'Rebound\nDraw a card.', { mana_cost: '{U}', cmc: 1 }),
  card('Discover Elf', 'Creature — Elf', 'When this creature enters, discover 3.', { mana_cost: '{3}{G}', cmc: 4, power: '3', toughness: '3' }),
  card('Big Spell', 'Sorcery', 'You gain 10 life.', { mana_cost: '{6}{G}', cmc: 7 }),
];

const bob = { kind: 'player' as const, player: 'bob' };

function withLibrary(alice: string[]): GameState {
  const g = toStep(start({ extra: CARDS, decks: { alice, bob: Array.from({ length: 40 }, () => 'Forest') }, seed: 1 }), 'main1');
  for (const name of CARDS.map((c) => c.name)) g.cards[name] = CARDS.find((c) => c.name === name)!;
  return g;
}
/** Puts these cards on top of Alice's library, first one on top. */
function stackLibrary(g: GameState, names: string[]): string[] {
  const ids = names.map((n) => give(g, 'alice', n, 'library'));
  const lib = g.zones.library.alice!;
  for (const id of ids) lib.splice(lib.indexOf(id), 1);
  lib.unshift(...ids);
  return ids;
}

describe('CR 702.85a: cascade', () => {
  it('exiles until a cheaper nonland card, which may be cast for free; the rest go to the bottom', () => {
    let g = withLibrary(Array.from({ length: 30 }, () => 'Forest'));
    const [f1, f2, zap] = stackLibrary(g, ['Forest', 'Forest', 'Zap']);
    g.players.alice!.pool.R = 4;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cascade Beast', 'hand') });
    g = passRound(g); // the cascade trigger resolves
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: zap });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true, targets: [[bob]] } });
    expect(g.objects[zap!]!.zone).toBe('stack');
    const lib = g.zones.library.alice!;
    expect(lib.slice(-2).sort()).toEqual([f1, f2].sort());
    g = passRound(g);
    expect(g.players.bob!.life).toBe(18);
  });
});

describe('CR 701.57a: discover', () => {
  it('a card with mana value N or less may be cast for free, or else goes to hand', () => {
    let g = withLibrary(Array.from({ length: 30 }, () => 'Forest'));
    const [big, zap] = stackLibrary(g, ['Big Spell', 'Zap']);
    give(g, 'alice', 'Discover Elf', 'hand');
    g.players.alice!.pool.G = 4;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: g.zones.hand.alice!.find((id) => g.objects[id]!.card === 'Discover Elf')! }));
    g = passRound(g); // enters trigger
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: zap });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: false } });
    expect(g.objects[zap!]!.zone).toBe('hand');
    expect(g.zones.library.alice!.at(-1)).toBe(big);
  });
});

describe('CR 702.88a: rebound', () => {
  it('cast from hand: exiled as it resolves, then cast again for free at your next upkeep', () => {
    let g = withLibrary(Array.from({ length: 30 }, () => 'Forest'));
    g.players.alice!.pool.U = 1;
    const spell = give(g, 'alice', 'Rebound Draw', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: spell }));
    expect(g.objects[spell]!.zone).toBe('exile');
    expect(g.zones.hand.alice!.length).toBe(hand); // -1 cast, +1 drawn
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[spell]!.zone).toBe('exile');
    g = toStep(g, 'upkeep', 'alice');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: spell });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
    g = passRound(g);
    // Cast from exile this time: to the graveyard.
    expect(g.objects[spell]!.zone).toBe('graveyard');
  });
});
