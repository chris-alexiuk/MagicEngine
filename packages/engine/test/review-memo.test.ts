import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

// Answers the engine remembers while it reads the board ("does anything give lands another type?") must not outlive
// the reading: within one action the board changes under them.
const CARDS = [
  makeCard({ name: 'Urborg Lite', type_line: 'Legendary Land', mana_cost: '', cmc: 0, oracle_text: 'Each land is a Swamp in addition to its other land types.' }),
  makeCard({ name: 'Swamp Watcher', type_line: 'Enchantment', mana_cost: '{B}', cmc: 1, oracle_text: 'Whenever a Swamp you control enters, you gain 1 life.' }),
];

describe('remembered board facts are dropped when the board changes', () => {
  it('a land that makes every land a Swamp is a Swamp as it enters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Swamp Watcher', 'battlefield');
    const urborg = give(g, 'alice', 'Urborg Lite', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: urborg });
    for (let i = 0; i < 4 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.players.alice!.life).toBe(21);
  });
});
