import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({
    name: 'Will Force',
    type_line: 'Instant',
    mana_cost: '{3}{U}{U}',
    oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nDraw a card.",
  }),
  makeCard({ name: 'Blue Thought', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Red Thought', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Gushing', type_line: 'Instant', mana_cost: '{4}{U}', oracle_text: "You may return two Islands you control to their owner's hand rather than pay this spell's mana cost.\nDraw two cards." }),
  makeCard({ name: 'Blue Trap', type_line: 'Instant — Trap', mana_cost: '{5}{R}', oracle_text: "If an opponent cast a blue spell this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life." }),
  makeCard({ name: 'Isle', type_line: 'Land — Island', mana_cost: '', oracle_text: '({T}: Add {U}.)' }),
];

describe('CR 118.9: alternative costs paid with cards', () => {
  it('"pay 1 life and exile a blue card from your hand" — a blue card, not the spell itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const force = give(g, 'alice', 'Will Force', 'hand');
    const red = give(g, 'alice', 'Red Thought', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: force, alt: 'alt', costs: { exile: [red] } })).toMatch(/hand to exile/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: force, alt: 'alt', costs: { exile: [force] } })).toMatch(/hand to exile/);
    const blue = give(g, 'alice', 'Blue Thought', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === force && a.alt === 'alt')).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: force, alt: 'alt', costs: { exile: [blue] } });
    expect(g.players.alice!.life).toBe(19);
    expect(g.zones.exile).toContain(blue);
    expect(g.stack.length).toBe(1);
  });

  it('"return two Islands you control to their owner\'s hand"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gush = give(g, 'alice', 'Gushing', 'hand');
    const a = give(g, 'alice', 'Isle', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: gush, alt: 'alt', costs: { returned: [a] } })).toMatch(/return/);
    const b = give(g, 'alice', 'Isle', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: gush, alt: 'alt', costs: { returned: [a, b] } });
    expect(g.zones.hand.alice).toContain(a);
    expect(g.zones.hand.alice).toContain(b);
    expect(g.stack.length).toBe(1);
  });

  it('trap conditions: "If an opponent cast a blue spell this turn"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const trap = give(g, 'alice', 'Blue Trap', 'hand');
    const red = give(g, 'bob', 'Red Thought', 'hand');
    const blue = give(g, 'bob', 'Blue Thought', 'hand');
    g.players.bob!.pool = { W: 0, U: 1, B: 0, R: 1, G: 0, C: 0 };
    g = act(g, { type: 'cast', player: 'bob', object: red });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(illegal(g, { type: 'cast', player: 'alice', object: trap, alt: 'alt' })).toBeTruthy();
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: blue });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: trap, alt: 'alt' });
    expect(g.stack.length).toBe(2);
  });
});
