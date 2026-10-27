import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Swat', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You may choose new targets for target spell or ability.' }),
  makeCard({ name: 'Zap', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Zap deals 3 damage to any target.' }),
];

describe('CR 115.7d: choosing new targets', () => {
  it('"You may choose new targets for target spell or ability."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zap = give(g, 'alice', 'Zap', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: zap, targets: [[{ kind: 'player', player: 'bob' }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    const swat = give(g, 'bob', 'Swat', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: swat, targets: [[{ kind: 'object', object: zap }]] });
    g = act(act(g, { type: 'pass', player: 'bob' }), { type: 'pass', player: 'alice' });
    // "You may": yes.
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'copy_targets', player: 'bob', object: zap });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'copy_targets', targets: [[{ kind: 'player', player: 'alice' }]] } });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.players.alice!.life).toBe(17);
    expect(g.players.bob!.life).toBe(20);
  });
});
