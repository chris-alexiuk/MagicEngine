import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Glacial Ray', type_line: 'Instant — Arcane', mana_cost: '{1}{R}', oracle_text: 'Glacial Ray deals 2 damage to any target.\nSplice onto Arcane {1}{R} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card\'s effects to that spell.)' }),
  makeCard({ name: 'Mists', type_line: 'Instant — Arcane', mana_cost: '{U}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Plain Draw', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Draw a card.' }),
];

describe('CR 702.47: splice onto Arcane', () => {
  it('the spell gains the spliced card’s text and its targets; the card stays in hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ray = give(g, 'alice', 'Glacial Ray', 'hand');
    const mists = give(g, 'alice', 'Mists', 'hand');
    const plain = give(g, 'alice', 'Plain Draw', 'hand');
    g.players.alice!.pool = { W: 0, U: 2, B: 0, R: 1, G: 0, C: 1 };
    expect(() => act(g, { type: 'cast', player: 'alice', object: plain, costs: { splice: [ray] }, targets: [[{ kind: 'player', player: 'bob' }]] })).toThrow(/Arcane/);
    // Not enough mana for both.
    const poor = structuredClone(g);
    poor.players.alice!.pool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
    expect(() => act(poor, { type: 'cast', player: 'alice', object: mists, costs: { splice: [ray] }, targets: [[{ kind: 'player', player: 'bob' }]] })).toThrow(/mana/);
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: mists, costs: { splice: [ray] }, targets: [[{ kind: 'player', player: 'bob' }]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.players.bob!.life).toBe(18);
    expect(g.objects[ray]!.zone).toBe('hand');
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 1);
  });
});
