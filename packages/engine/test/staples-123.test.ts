import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Goldspan', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever Goldspan becomes the target of a spell, you gain 2 life.' }),
  makeCard({ name: 'Giant', type_line: 'Creature — Giant', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: "Whenever Giant becomes the target of a spell, Giant deals 2 damage to that spell's controller." }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 1 damage to any target.' }),
  makeCard({ name: 'Tapper', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Tap target creature.' }),
  makeCard({ name: 'Vampire', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Whenever one or more other creatures you control enter, you gain 1 life. This ability triggers only once each turn.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Tax', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, if an opponent controls more lands than you, you gain 3 life.' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slices 123–124)', () => {
  it('Goldspan Dragon: "becomes the target of a spell" ignores abilities', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dragon = give(g, 'alice', 'Goldspan', 'battlefield');
    const tapper = give(g, 'bob', 'Tapper', 'battlefield', { sick: false });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'activate', player: 'bob', object: tapper, ability: 0, targets: [[{ kind: 'object', object: dragon }]] }));
    expect(g.objects[dragon]!.tapped).toBe(true);
    expect(g.players.alice!.life).toBe(20);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: dragon }]] }));
    expect(g.players.alice!.life).toBe(22);
  });

  it('Bonecrusher Giant: damage to the targeting spell\'s controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const giant = give(g, 'bob', 'Giant', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: giant }]] }));
    expect(g.players.alice!.life).toBe(18);
    expect(g.objects[giant]!.damage).toBe(1);
  });

  it('Welcoming Vampire: "one or more other creatures you control enter", once each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vampire', 'hand') }));
    expect(g.players.alice!.life).toBe(20);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    expect(g.players.alice!.life).toBe(21);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    expect(g.players.alice!.life).toBe(21);
    g = settle(act(g, { type: 'pass', player: 'alice' }));
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bear', 'hand') }));
    expect(g.players.alice!.life).toBe(21);
  });

  it('Land Tax: "if an opponent controls more lands than you"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tax', 'battlefield');
    give(g, 'alice', 'Plains', 'battlefield');
    give(g, 'bob', 'Plains', 'battlefield');
    g = toStep(g, 'draw', 'alice');
    expect(g.players.alice!.life).toBe(20);
    give(g, 'bob', 'Plains', 'battlefield');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.players.alice!.life).toBe(23);
  });
});
