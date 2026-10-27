import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Song of Growth', type_line: 'Sorcery', mana_cost: '{2}{G}', oracle_text: 'Draw two cards.\nHarmonize {4}{G} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by {X}, where X is its power. Then exile this spell.)' }),
  makeCard({ name: 'Big Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
];

describe('CR 702.180: harmonize', () => {
  it('cast from the graveyard; the tapped creature’s power comes off; then it’s exiled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const song = give(g, 'alice', 'Song of Growth', 'graveyard');
    const bear = give(g, 'alice', 'Big Bear', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === song && a.alt === 'harmonize')).toBe(true);
    expect(() => act(g, { type: 'cast', player: 'alice', object: song, alt: 'harmonize' })).toThrow(/mana/);
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: song, alt: 'harmonize', costs: { crew: [bear] } });
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.players.alice!.pool.G).toBe(0);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.objects[song]!.zone).toBe('exile');
  });
});
