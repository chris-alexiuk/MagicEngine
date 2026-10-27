import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Silent Turn', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Your opponents can't cast spells during your turn." }),
  makeCard({ name: 'One Rule', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Each player can't cast more than one spell each turn." }),
  makeCard({ name: 'Hush', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target player can't cast spells this turn." }),
  makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Lockdown', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Your opponents can't cast creature spells." }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 20 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe("CR 101.2: can't cast", () => {
  it('"Your opponents can\'t cast spells during your turn."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Silent Turn', 'battlefield');
    const ping = give(g, 'bob', 'Ping', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') });
    // Bob has priority with Alice's spell on the stack, during her turn.
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.priority).toBe('bob');
    expect(illegal(g, { type: 'cast', player: 'bob', object: ping })).toMatch(/can't be cast/);
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === ping)).toBe(false);
    g = settle(g);
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'cast', player: 'bob', object: ping });
    expect(g.stack.length).toBe(1);
  });

  it('"Each player can\'t cast more than one spell each turn."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'One Rule', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') }));
    const second = give(g, 'alice', 'Ping', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: second })).toMatch(/can't be cast/);
  });

  it('"Target player can\'t cast spells this turn." — for the rest of the turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ping = give(g, 'bob', 'Ping', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hush', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = act(toStep(g, 'end', 'alice'), { type: 'pass', player: 'alice' });
    expect(g.priority).toBe('bob');
    expect(illegal(g, { type: 'cast', player: 'bob', object: ping })).toMatch(/can't/);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.priority).toBe('bob');
    g = act(g, { type: 'cast', player: 'bob', object: ping });
    expect(g.stack.length).toBe(1);
  });

  it('a filter: "Your opponents can\'t cast creature spells." (other spells are fine)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Lockdown', 'battlefield');
    const cub = give(g, 'bob', 'Grizzly Cub', 'hand');
    expect(illegal(g, { type: 'cast', player: 'bob', object: cub })).toMatch(/can't be cast/);
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Ping', 'hand') });
    expect(g.stack.length).toBe(1);
  });
});
