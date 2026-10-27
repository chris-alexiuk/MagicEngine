import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Scatter', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'For each opponent, exile up to one target creature that player controls.' }),
  makeCard({ name: 'Sweep Each', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'For each opponent, destroy target creature that player controls.' }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

const obj = (id: string) => ({ kind: 'object' as const, object: id });

function settle(g: GameState): GameState {
  for (let i = 0; i < 20 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('CR 601.2c: "for each opponent, … target … that player controls"', () => {
  it('one target per opponent, each a different player\'s', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const b1 = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const b2 = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const c1 = give(g, 'carol', 'Grizzly Cub', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly Cub', 'battlefield');
    const spell = give(g, 'alice', 'Scatter', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(b1), obj(b2)]] })).toMatch(/different player/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(mine)]] })).toMatch(/different player/);
    const offered = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === spell);
    expect(offered && offered.type === 'cast' ? offered.targets?.[0]?.length : 0).toBe(2);
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(b1), obj(c1)]] }));
    expect(g.zones.exile).toEqual(expect.arrayContaining([b1, c1]));
    expect(g.zones.battlefield).toEqual(expect.arrayContaining([b2, mine]));
  });

  it('without "up to": a target for each opponent who has one', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const b1 = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const spell = give(g, 'alice', 'Sweep Each', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === spell)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(b1)]] }));
    expect(g.zones.battlefield.includes(b1)).toBe(false);
    const c1 = give(g, 'carol', 'Grizzly Cub', 'battlefield');
    const b2 = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const again = give(g, 'alice', 'Sweep Each', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: again, targets: [[obj(b2)]] })).toMatch(/one for each player/);
    expect(c1).toBeDefined();
  });
});
