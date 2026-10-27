import { describe, expect, it } from 'vitest';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Spread Growth', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Distribute three +1/+1 counters among one, two, or three target creatures.' }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

describe('CR 601.2d: distributing counters', () => {
  it('as divided when cast; at least one each', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'alice', 'Grizzly Cub', 'battlefield');
    const b = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const spell = give(g, 'alice', 'Spread Growth', 'hand');
    const targets = [[{ kind: 'object' as const, object: a }, { kind: 'object' as const, object: b }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets, divide: [3, 0] })).toMatch(/at least 1 each/);
    g = act(g, { type: 'cast', player: 'alice', object: spell, targets, divide: [2, 1] });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.objects[a]!.counters['+1/+1']).toBe(2);
    expect(g.objects[b]!.counters['+1/+1']).toBe(1);
  });
});
