import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Spree Lite', type_line: 'Sorcery', oracle_text: 'Spree (Choose one or more additional costs.)\n+ {1} — You gain 2 life.\n+ {2} — You gain 3 life.', mana_cost: '{R}', cmc: 1 }),
  makeCard({ name: 'Tier Lite', type_line: 'Sorcery', oracle_text: 'Tiered (Choose one additional cost.)\n• Low — {0} — You gain 1 life.\n• High — {3} — You gain 6 life.', mana_cost: '{R}', cmc: 1 }),
];

describe('CR 702.172 spree / 702.183 tiered: modes with their own additional costs', () => {
  it('spree: each chosen mode adds its cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const s = give(g, 'alice', 'Spree Lite', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    expect(() => act(g, { type: 'cast', player: 'alice', object: s, modes: [0] })).toThrow(/mana/);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 3 };
    g = act(g, { type: 'cast', player: 'alice', object: s, modes: [0, 1] });
    expect(g.players.alice!.pool.C).toBe(0);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.players.alice!.life).toBe(25);
  });

  it('tiered: one mode; a {0} tier costs nothing more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const t = give(g, 'alice', 'Tier Lite', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    expect(() => act(g, { type: 'cast', player: 'alice', object: t, modes: [0, 1] })).toThrow();
    const offer = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === t);
    expect(offer).toMatchObject({ modes: [0] });
    g = act(g, { type: 'cast', player: 'alice', object: t, modes: [0] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.players.alice!.life).toBe(21);
  });
});
