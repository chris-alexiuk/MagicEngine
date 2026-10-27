import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Rhythm', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Nontoken creatures you control have riot.' }),
  makeCard({ name: 'Exalter', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Creatures you control have exalted.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('granted keywords defined by their CR text (CR 614.12, 702)', () => {
  it('Rhythm of the Wild: an entering creature has riot', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Rhythm', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.pending).toMatchObject({ kind: 'as_enters' });
  });

  it('granted exalted triggers', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Exalter', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield', { sick: false });
    give(g, 'alice', 'Bear', 'battlefield', { sick: false });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.stack.length).toBe(2);
  });
});
