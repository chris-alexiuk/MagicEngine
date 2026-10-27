import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Landscape', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Island', type_line: 'Basic Land — Island', mana_cost: '', oracle_text: '({T}: Add {U}.)' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 134)', () => {
  it('Myriad Landscape: the two lands must share a land type', () => {
    let g = toStep(start({ extra: CARDS, decks: { alice: [...Array(20).fill('Forest'), ...Array(20).fill('Island'), 'Landscape'], bob: Array(40).fill('Forest') } }), 'main1', 'alice');
    const scape = give(g, 'alice', 'Landscape', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: scape, ability: 0 }));
    expect(g.pending).toMatchObject({ kind: 'search', sameLandType: true });
    const lib = g.zones.library.alice!;
    const forest = lib.find((id) => g.objects[id]!.card === 'Forest')!;
    const island = lib.find((id) => g.objects[id]!.card === 'Island')!;
    const forest2 = lib.filter((id) => g.objects[id]!.card === 'Forest')[1]!;
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [forest, island] } })).toMatch(/share a land type/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [forest, forest2] } }));
    expect([forest, forest2].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'battlefield']);
  });
});

describe('"the next spell you cast this turn" (slice 135)', () => {
  const MORE = [
    makeCard({ name: 'Village', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Add {U}.\n{T}: The next spell you cast this turn can't be countered." }),
    makeCard({ name: 'Bargain', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'The next creature spell you cast this turn costs {2} less to cast.' }),
    makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
    makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
    makeCard({ name: 'Nope', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
  ];
  it('Mistrise Village: only the next spell, and only this turn', () => {
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const village = give(g, 'alice', 'Village', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: village, ability: 0 }));
    const first = give(g, 'alice', 'Ping', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: first });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Nope', 'hand'), targets: [[{ kind: 'object', object: first }]] }));
    expect(g.players.alice!.life).toBe(21);
    const second = give(g, 'alice', 'Ping', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: second });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Nope', 'hand'), targets: [[{ kind: 'object', object: second }]] }));
    expect(g.players.alice!.life).toBe(21);
  });

  it('"The next creature spell you cast this turn costs {2} less to cast"', () => {
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bargain', 'hand') }));
    // A noncreature spell doesn't use it up.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') }));
    g.players.alice!.pool.G = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    g.players.alice!.pool.G = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') })).toMatch(/mana/i);
  });
});

describe('War Room (slice 136)', () => {
  it('"Pay life equal to the number of colors in your commanders\' color identity"', () => {
    const MORE = [
      makeCard({ name: 'War Room', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Add {C}.\n{T}, Pay life equal to the number of colors in your commanders' color identity: Draw a card." }),
      makeCard({ name: 'Gruul Lord', type_line: 'Legendary Creature — Ogre', mana_cost: '{R}{G}', color_identity: ['R', 'G'], power: '2', toughness: '2', oracle_text: '' }),
    ];
    const deck = [...Array(97).fill('Forest'), 'War Room', 'Gruul Lord'];
    let g = toStep(start({ format: 'commander', extra: MORE, decks: { alice: deck, bob: Array(99).fill('Forest') }, commanders: { alice: ['Gruul Lord'] } }), 'main1', 'alice');
    const room = give(g, 'alice', 'War Room', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: room, ability: 0 }));
    expect(g.players.alice!.life).toBe(life - 2);
  });
});

describe('Gamble', () => {
  it('search for a card, then discard a card at random', () => {
    const MORE = [makeCard({ name: 'Gamble', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a card, put that card into your hand, discard a card at random, then shuffle.' })];
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gamble', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'search' });
    const pick = (g.pending as { candidates: string[] }).candidates[0]!;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [pick] } }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    expect(g.zones.graveyard.alice!.length).toBe(2);
  });
});

describe('Victimize', () => {
  it('"Sacrifice a creature. If you do, return the chosen cards"', () => {
    const MORE = [
      makeCard({ name: 'Victimize', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.' }),
      makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
    ];
    let g = toStep(start({ extra: MORE }), 'main1', 'alice');
    const dead = [give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Bear', 'graveyard')];
    const targets = [dead.map((id) => ({ kind: 'object' as const, object: id }))];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Victimize', 'hand'), targets }));
    expect(dead.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
    const fodder = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Victimize', 'hand'), targets }));
    expect(g.objects[fodder]!.zone).toBe('graveyard');
    expect(dead.map((id) => [g.objects[id]!.zone, g.objects[id]!.tapped])).toEqual([['battlefield', true], ['battlefield', true]]);
  });
});
