import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Snapper', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.' }),
  makeCard({ name: 'Flames', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.' }),
  makeCard({ name: 'Lier', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Spells can't be countered.\nEach instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost." }),
  makeCard({ name: 'Doctor', type_line: 'Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, target instant or sorcery card in your graveyard gains flashback {1} until end of turn.' }),
  makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Nope', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const fromYard = (g: GameState, id: string) => legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === id);

describe('flashback given by effects (CR 702.34a)', () => {
  it('Snapcaster Mage: cast it from the graveyard for its mana cost this turn, then it is exiled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ping = give(g, 'alice', 'Ping', 'graveyard');
    g.players.alice!.pool.R = 1;
    expect(fromYard(g, ping)).toBe(false);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Snapper', 'hand') }));
    expect(fromYard(g, ping)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: ping }));
    expect(g.players.alice!.life).toBe(21);
    expect(g.objects[ping]!.zone).toBe('exile');
  });

  it('only until end of turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ping = give(g, 'alice', 'Ping', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Flames', 'hand') }));
    g.players.alice!.pool.R = 1;
    expect(fromYard(g, ping)).toBe(true);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.R = 1;
    expect(fromYard(g, ping)).toBe(false);
    expect(illegal(g, { type: 'cast', player: 'alice', object: ping })).toMatch(/hand/);
  });

  it('Lier: a static grant, and spells can\'t be countered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ping = give(g, 'alice', 'Ping', 'graveyard');
    give(g, 'alice', 'Lier', 'battlefield');
    g.players.alice!.pool.R = 1;
    expect(fromYard(g, ping)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: ping });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Nope', 'hand'), targets: [[{ kind: 'object', object: ping }]] }));
    expect(g.players.alice!.life).toBe(21);
  });

  it('a flashback cost of its own: "gains flashback {1}"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ping = give(g, 'alice', 'Ping', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Doctor', 'hand') }));
    g.players.alice!.pool.C = 1;
    expect(fromYard(g, ping)).toBe(true);
  });
});

describe('keywords for spells (CR 613.1f)', () => {
  it('"Instant and sorcery spells you control have lifelink"', () => {
    const MORE = [
      makeCard({ name: 'Duelist', type_line: 'Creature — Human', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'Instant and sorcery spells you control have lifelink.' }),
      makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
    ];
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.alice!.life).toBe(20);
    give(g, 'alice', 'Duelist', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.alice!.life).toBe(22);
    expect(g.players.bob!.life).toBe(16);
  });
});
