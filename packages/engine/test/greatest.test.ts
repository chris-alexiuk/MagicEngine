import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Measure', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain life equal to the greatest power among non-Bear creatures you control.' }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '5', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre Brute', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Goblin Kid', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
];

describe('"the greatest power among …"', () => {
  it('counts only the creatures the phrase describes', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Grizzly Cub', 'battlefield');
    give(g, 'alice', 'Ogre Brute', 'battlefield');
    give(g, 'alice', 'Goblin Kid', 'battlefield');
    give(g, 'bob', 'Ogre Brute', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Measure', 'hand') });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.players.alice!.life).toBe(23);
  });
});
