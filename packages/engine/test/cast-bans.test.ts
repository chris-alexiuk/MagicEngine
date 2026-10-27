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
  makeCard({ name: 'Abolisher', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments." }),
  makeCard({ name: 'Elfling', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Life Stone', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: You gain 1 life.' }),
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

  it('Grand Abolisher: during your turn, opponents can\'t cast spells or activate abilities of artifacts, creatures, or enchantments', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Abolisher', 'battlefield');
    const elf = give(g, 'bob', 'Elfling', 'battlefield', { sick: false });
    const stone = give(g, 'bob', 'Life Stone', 'battlefield');
    const forest = give(g, 'bob', 'Forest', 'battlefield');
    const ping = give(g, 'bob', 'Ping', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') });
    g = act(g, { type: 'pass', player: 'alice' });
    expect(illegal(g, { type: 'cast', player: 'bob', object: ping })).toMatch(/can't be cast/);
    expect(illegal(g, { type: 'activate', player: 'bob', object: stone, ability: 0 })).toMatch(/can’t activate/);
    expect(illegal(g, { type: 'activate_mana', player: 'bob', object: elf, ability: 0 })).toMatch(/can’t activate/);
    const offered = legalActions(g, 'bob');
    expect(offered.some((a) => (a.type === 'activate' || a.type === 'activate_mana') && (a.object === elf || a.object === stone))).toBe(false);
    // Lands aren't covered.
    expect(offered.some((a) => a.type === 'activate_mana' && a.object === forest)).toBe(true);
    g = settle(act(g, { type: 'pass', player: 'bob' }));
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'activate', player: 'bob', object: stone, ability: 0 });
    expect(g.stack.length).toBe(1);
  });
});
