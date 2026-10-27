import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Sanctuary', type_line: 'Land — Island', mana_cost: '', oracle_text: 'This land enters tapped unless you control three or more other Islands.\nWhen this land enters untapped, you gain 2 life.' }),
  makeCard({ name: 'Island', type_line: 'Basic Land — Island', mana_cost: '', oracle_text: '({T}: Add {U}.)' }),
  makeCard({ name: 'Connections', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your first main phase, choose one or more —\n• Sell Contraband — You gain 1 life.\n• Buy Information — Draw a card. You lose 2 life.' }),
];

describe('staples (slice 129)', () => {
  it('Mystic Sanctuary: "When ~ enters untapped"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Sanctuary', 'hand') });
    expect(g.stack).toHaveLength(0);
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Island', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Sanctuary', 'hand') });
    expect(g.stack).toHaveLength(1);
  });

  it('named modes ("• Sell Contraband — …") read like any others', () => {
    const g = start({ extra: CARDS });
    const ab = g.cards.Connections!.faces[0]!.abilities[0]!;
    expect(ab).toMatchObject({ kind: 'triggered', modes: { min: 1, max: 2 } });
  });
});
